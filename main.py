from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr
from typing import Dict, List
import json
import random
import time
import secrets
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

app = FastAPI()

# Configuration για SMTP Email
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587
SMTP_EMAIL = "evopc2000@gmail.com"
SMTP_PASSWORD = "mrxr ixvj plqt usrf"

def send_email(to_email: str, subject: str, body: str):
    try:
        msg = MIMEMultipart()
        msg['From'] = SMTP_EMAIL
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(body, 'html'))

        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
        server.starttls()
        server.login(SMTP_EMAIL, SMTP_PASSWORD)
        server.send_message(msg)
        server.quit()
    except Exception as e:
        print(f"Email error: {e}")

# Databases στην μνήμη
users_db = {
    "admin": {
        "password": "admin123",
        "email": "admin@nexus.com",
        "verified": True
    }
}
pending_users = {}   # {username: {password, email, otp, expires_at}}
login_otps = {}      # {username: {otp, expires_at}}
reset_tokens = {}    # {token: {username, expires_at}}

orders_db = []
chats_db = {}

# WebSockets Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, order_id: int, websocket: WebSocket):
        await websocket.accept()
        if order_id not in self.active_connections:
            self.active_connections[order_id] = []
        self.active_connections[order_id].append(websocket)

    def disconnect(self, order_id: int, websocket: WebSocket):
        if order_id in self.active_connections:
            self.active_connections[order_id].remove(websocket)

    async def broadcast(self, order_id: int, message: str):
        if order_id in self.active_connections:
            for connection in self.active_connections[order_id]:
                await connection.send_text(message)

manager = ConnectionManager()

# Data Models
class SignupModel(BaseModel):
    username: str
    email: EmailStr
    password: str

class VerifyOTPModel(BaseModel):
    username: str
    otp: str

class LoginRequestModel(BaseModel):
    username: str
    password: str

class ForgotPasswordModel(BaseModel):
    email: str

class ResetPasswordModel(BaseModel):
    token: str
    new_password: str

class OrderModel(BaseModel):
    username: str
    discord_user: str
    service: str
    price: float
    paysafe_pin: str

class DeclineModel(BaseModel):
    order_id: int
    reason: str

# --- AUTH ENDPOINTS ---

@app.post("/api/signup/request")
def signup_request(data: SignupModel):
    if data.username in users_db:
        raise HTTPException(status_code=400, detail="User already exists")
    
    otp = str(random.randint(100000, 999999))
    expires_at = time.time() + 900  # 15 λεπτά λήξη
    
    pending_users[data.username] = {
        "password": data.password,
        "email": data.email,
        "otp": otp,
        "expires_at": expires_at
    }
    
    send_email(data.email, "Nexus Services - Verification Code", f"Ο 6-ψήφιος κωδικός επαλήθευσης είναι: <b>{otp}</b>")
    print(f"\n[DEV MODE] OTP for {data.username}: {otp}\n")
    return {"status": "ok"}

@app.post("/api/signup/verify")
def signup_verify(data: VerifyOTPModel):
    user_data = pending_users.get(data.username)
    if not user_data:
        raise HTTPException(status_code=400, detail="Δεν βρέθηκε αίτημα εγγραφής.")
    
    if time.time() > user_data["expires_at"]:
        del pending_users[data.username]
        raise HTTPException(status_code=400, detail="Ο κωδικός έληξε. Κάντε ξανά εγγραφή.")
        
    if user_data["otp"] != data.otp:
        raise HTTPException(status_code=400, detail="Λάθος κωδικός OTP.")
        
    users_db[data.username] = {
        "password": user_data["password"],
        "email": user_data["email"],
        "verified": True
    }
    del pending_users[data.username]
    return {"status": "ok"}

@app.post("/api/login/request")
def login_request(data: LoginRequestModel):
    user = users_db.get(data.username)
    if not user or user["password"] != data.password:
        raise HTTPException(status_code=400, detail="Λανθασμένα στοιχεία σύνδεσης.")
    
    otp = str(random.randint(100000, 999999))
    expires_at = time.time() + 900
    
    login_otps[data.username] = {
        "otp": otp,
        "expires_at": expires_at
    }
    
    send_email(user["email"], "Nexus Services - Login OTP", f"Ο κωδικός επιβεβαίωσης εισόδου είναι: <b>{otp}</b>")
    print(f"\n[DEV MODE] Login OTP for {data.username}: {otp}\n")
    return {"status": "ok"}

@app.post("/api/login/verify")
def login_verify(data: VerifyOTPModel):
    otp_data = login_otps.get(data.username)
    if not otp_data:
        raise HTTPException(status_code=400, detail="Δεν βρέθηκε αίτημα σύνδεσης.")
        
    if time.time() > otp_data["expires_at"]:
        del login_otps[data.username]
        raise HTTPException(status_code=400, detail="Ο κωδικός έληξε.")
        
    if otp_data["otp"] != data.otp:
        raise HTTPException(status_code=400, detail="Λάθος κωδικός OTP.")
        
    del login_otps[data.username]
    is_admin = (data.username == "admin")
    return {"status": "ok", "is_admin": is_admin}

@app.post("/api/forgot-password")
def forgot_password(data: ForgotPasswordModel):
    found_username = None
    for uname, uinfo in users_db.items():
        if uinfo["email"] == data.email:
            found_username = uname
            break
            
    # Για λόγους ασφαλείας, αν δεν βρεθεί το email επιστρέφουμε θετικό μήνυμα χωρίς να στείλουμε τίποτα!
    if not found_username:
        return {"status": "ok", "message": "Check your email."}
        
    token = secrets.token_urlsafe(32)
    expires_at = time.time() + 86400  # 1 ημέρα λήξη
    
    reset_tokens[token] = {
        "username": found_username,
        "expires_at": expires_at
    }
    
    reset_link = f"http://127.0.0.1:8000/reset-password.html?token={token}"
    send_email(data.email, "Nexus Services - Reset Password", f"Πάτα στον σύνδεσμο για αλλαγή κωδικού: <a href='{reset_link}'>{reset_link}</a>")
    print(f"\n[DEV MODE] Reset Link: {reset_link}\n")
    
    return {"status": "ok", "message": "Check your email."}

@app.post("/api/reset-password")
def reset_password(data: ResetPasswordModel):
    token_data = reset_tokens.get(data.token)
    if not token_data:
        raise HTTPException(status_code=400, detail="Άκυρος ή χρησιμοποιημένος σύνδεσμος.")
        
    if time.time() > token_data["expires_at"]:
        del reset_tokens[data.token]
        raise HTTPException(status_code=400, detail="Ο σύνδεσμος έχει λήξει (1 ημέρα).")
        
    username = token_data["username"]
    users_db[username]["password"] = data.new_password
    
    del reset_tokens[data.token] # Λήγει αμέσως μετά τη χρήση
    return {"status": "ok", "message": "Ο κωδικός άλλαξε επιτυχώς!"}

# --- ORDERS & CHAT ENDPOINTS ---
@app.post("/api/orders/create")
def create_order(order: OrderModel):
    order_id = len(orders_db) + 1
    new_order = {
        "id": order_id,
        "username": order.username,
        "discord_user": order.discord_user,
        "service": order.service,
        "price": order.price,
        "paysafe_pin": order.paysafe_pin,
        "status": "pending",
        "decline_reason": ""
    }
    orders_db.append(new_order)
    return {"status": "ok", "order_id": order_id}

@app.get("/api/admin/orders")
def get_admin_orders():
    return [o for o in orders_db if o["status"] == "pending"]

@app.post("/api/admin/accept")
def accept_order(payload: dict):
    order_id = payload.get("order_id")
    for o in orders_db:
        if o["id"] == order_id:
            o["status"] = "accepted"
            chats_db[order_id] = []
            return {"status": "ok"}
    raise HTTPException(status_code=404, detail="Order not found")

@app.post("/api/admin/decline")
def decline_order(data: DeclineModel):
    for o in orders_db:
        if o["id"] == data.order_id:
            o["status"] = "declined"
            o["decline_reason"] = data.reason
            return {"status": "ok"}
    raise HTTPException(status_code=404, detail="Order not found")

@app.get("/api/user/notifications/{username}")
def check_notifications(username: str):
    user_orders = [o for o in orders_db if o["username"] == username]
    return {"orders": user_orders}

@app.post("/api/orders/close")
def close_order(payload: dict):
    order_id = payload.get("order_id")
    for o in orders_db:
        if o["id"] == order_id:
            o["status"] = "closed"
            return {"status": "ok"}
    raise HTTPException(status_code=404, detail="Order not found")

@app.websocket("/ws/chat/{order_id}")
async def websocket_chat(websocket: WebSocket, order_id: int):
    await manager.connect(order_id, websocket)
    if order_id in chats_db:
        for msg in chats_db[order_id]:
            await websocket.send_text(json.dumps(msg))
    try:
        while True:
            data_str = await websocket.receive_text()
            data = json.loads(data_str)
            if order_id not in chats_db:
                chats_db[order_id] = []
            chats_db[order_id].append(data)
            await manager.broadcast(order_id, json.dumps(data))
    except WebSocketDisconnect:
        manager.disconnect(order_id, websocket)

app.mount("/", StaticFiles(directory=".", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)