document.addEventListener("DOMContentLoaded", () => {
    let currentUser = null;
    let isAdmin = false;
    let activeOrderId = null;
    let selectedDeclineOrderId = null;
    let selectedService = "";
    let selectedPrice = "0.00";
    let ws = null;
    let currentAuthType = "login";

    const authModal = document.getElementById("authModal");
    const forgotModal = document.getElementById("forgotModal");
    const orderModal = document.getElementById("orderModal");
    const declineModal = document.getElementById("declineModal");
    const chatModal = document.getElementById("chatModal");
    
    document.getElementById("openLoginBtn").onclick = () => openAuth("login");
    document.getElementById("openSignupBtn").onclick = () => openAuth("signup");
    document.getElementById("closeAuthModalBtn").onclick = () => authModal.classList.remove("active");
    document.getElementById("logoutBtn").onclick = logout;

    function openAuth(type) {
        currentAuthType = type;
        authModal.classList.add("active");
        document.getElementById("authStep1").classList.remove("hidden");
        document.getElementById("authStep2").classList.add("hidden");
        document.getElementById("authModalTitle").textContent = type === "login" ? "Login" : "Sign Up";

        if(type === "signup") {
            document.getElementById("emailGroup").classList.remove("hidden");
        } else {
            document.getElementById("emailGroup").classList.add("hidden");
        }
    }

    document.getElementById("authSubmitBtn").onclick = async () => {
        const user = document.getElementById("authUsername").value.trim();
        const pass = document.getElementById("authPassword").value.trim();
        const email = document.getElementById("authEmail").value.trim();

        if(!user || !pass || (currentAuthType === "signup" && !email)) {
            return alert("Συμπληρώστε όλα τα πεδία!");
        }

        const endpoint = currentAuthType === "signup" ? "/api/signup/request" : "/api/login/request";
        const bodyData = currentAuthType === "signup" ? { username: user, email: email, password: pass } : { username: user, password: pass };

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(bodyData)
        });

        const data = await res.json();
        if(res.ok) {
            document.getElementById("authStep1").classList.add("hidden");
            document.getElementById("authStep2").classList.remove("hidden");
        } else {
            alert(data.detail || "Σφάλμα.");
        }
    };

    document.getElementById("verifyOtpBtn").onclick = async () => {
        const user = document.getElementById("authUsername").value.trim();
        const otp = document.getElementById("otpInput").value.trim();

        if(!otp || otp.length !== 6) return alert("Εισάγετε 6-ψήφιο κωδικό OTP!");

        const endpoint = currentAuthType === "signup" ? "/api/signup/verify" : "/api/login/verify";

        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ username: user, otp: otp })
        });

        const data = await res.json();
        if(res.ok) {
            alert(currentAuthType === "signup" ? "Ο κωδικός είναι σωστός! Το account ενεργοποιήθηκε." : "Επιτυχής σύνδεση!");
            
            currentUser = user;
            isAdmin = data.is_admin || (user === "admin");

            authModal.classList.remove("active");
            document.getElementById("authButtons").classList.add("hidden");
            document.getElementById("userProfile").classList.remove("hidden");
            document.getElementById("navUsername").textContent = user;

            if(isAdmin) {
                document.getElementById("adminPanel").classList.remove("hidden");
                loadAdminOrders();
            } else {
                checkUserNotifications();
            }
        } else {
            alert(data.detail || "Λάθος OTP.");
        }
    };

    document.getElementById("forgotPasswordLink").onclick = (e) => {
        e.preventDefault();
        authModal.classList.remove("active");
        forgotModal.classList.add("active");
    };

    document.getElementById("closeForgotModalBtn").onclick = () => forgotModal.classList.remove("active");

    document.getElementById("submitForgotBtn").onclick = async () => {
        const email = document.getElementById("forgotEmail").value.trim();
        if(!email) return alert("Εισάγετε email!");

        const res = await fetch('/api/forgot-password', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ email: email })
        });

        const data = await res.json();
        alert(data.message);
        forgotModal.classList.remove("active");
    };

    function logout() {
        currentUser = null;
        isAdmin = false;
        activeOrderId = null;
        if(ws) ws.close();
        location.reload();
    }

    document.querySelectorAll(".buy-btn").forEach(btn => {
        btn.onclick = () => {
            if(!currentUser) return alert("Πρέπει να κάνετε Login πρώτα!");
            selectedService = btn.getAttribute("data-title");
            selectedPrice = btn.getAttribute("data-price");

            document.getElementById("orderModalTitle").textContent = `Πακέτο: ${selectedService} (${selectedPrice}€)`;
            orderModal.classList.add("active");
        };
    });

    document.getElementById("closeOrderModalBtn").onclick = () => orderModal.classList.remove("active");

    document.getElementById("submitOrderBtn").onclick = async () => {
        const discordUser = document.getElementById("orderDiscordUser").value.trim();
        const pin = document.getElementById("paysafePin").value.trim();

        if(!discordUser || pin.length < 16) {
            return alert("Εισάγετε έγκυρο Discord User και 16-ψήφιο Paysafe PIN!");
        }

        const res = await fetch('/api/orders/create', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                username: currentUser,
                discord_user: discordUser,
                service: selectedService,
                price: parseFloat(selectedPrice),
                paysafe_pin: pin
            })
        });

        if(res.ok) {
            alert("Η παραγγελία σας υποβλήθηκε επιτυχώς! Περιμένετε την έγκριση του Admin.");
            orderModal.classList.remove("active");
        }
    };

    async function loadAdminOrders() {
        const res = await fetch('/api/admin/orders');
        const orders = await res.json();
        const container = document.getElementById("ordersList");
        container.innerHTML = "";

        if(orders.length === 0) {
            container.innerHTML = "<p style='color: var(--text-muted);'>Δεν υπάρχουν εκκρεμείς παραγγελίες.</p>";
            return;
        }

        orders.forEach(o => {
            container.innerHTML += `
                <div class="order-item">
                    <div>
                        <p><strong>User:</strong> ${o.username} (${o.discord_user})</p>
                        <p><strong>Υπηρεσία:</strong> ${o.service} (${o.price}€)</p>
                        <p><strong>Paysafe PIN:</strong> <mark>${o.paysafe_pin}</mark></p>
                    </div>
                    <div class="actions">
                        <button class="btn btn-primary btn-sm" onclick="acceptOrder(${o.id})">Accept & Chat</button>
                        <button class="btn btn-danger btn-sm" onclick="openDeclineModal(${o.id})">Decline</button>
                    </div>
                </div>
            `;
        });
    }

    window.acceptOrder = async (id) => {
        await fetch('/api/admin/accept', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({order_id: id})
        });
        activeOrderId = id;
        loadAdminOrders();
        openChat();
    };

    window.openDeclineModal = (id) => {
        selectedDeclineOrderId = id;
        declineModal.classList.add("active");
    };

    document.getElementById("closeDeclineModalBtn").onclick = () => declineModal.classList.remove("active");

    document.getElementById("confirmDeclineBtn").onclick = async () => {
        const reason = document.getElementById("declineReasonInput").value.trim();
        if(!reason) return alert("Γράψτε την αιτία απόρριψης!");

        await fetch('/api/admin/decline', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({order_id: selectedDeclineOrderId, reason: reason})
        });

        declineModal.classList.remove("active");
        loadAdminOrders();
    };

    async function checkUserNotifications() {
        const res = await fetch(`/api/user/notifications/${currentUser}`);
        const data = await res.json();

        data.orders.forEach(o => {
            if(o.status === "declined") {
                document.getElementById("declineBanner").classList.remove("hidden");
                document.getElementById("declineReasonText").textContent = `Αιτία: ${o.decline_reason}`;
            }
            if(o.status === "accepted") {
                activeOrderId = o.id;
                document.getElementById("openChatBtn").classList.remove("hidden");
                document.getElementById("chatBadge").classList.remove("hidden");
            }
        });
    }

    document.getElementById("closeBannerBtn").onclick = () => {
        document.getElementById("declineBanner").classList.add("hidden");
    };

    document.getElementById("openChatBtn").onclick = openChat;
    document.getElementById("closeChatModalBtn").onclick = () => chatModal.classList.remove("active");

    function openChat() {
        chatModal.classList.add("active");
        document.getElementById("chatBadge").classList.add("hidden");
        if(isAdmin) document.getElementById("closeOrderBtn").classList.remove("hidden");

        connectWebSocket();
    }

    function connectWebSocket() {
        if(ws) return;
        const protocol = location.protocol === "https:" ? "wss" : "ws";
        ws = new WebSocket(`${protocol}://${location.host}/ws/chat/${activeOrderId}`);

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            appendMessage(data.sender, data.text);
        };
    }

    function appendMessage(sender, text) {
        const chatMessages = document.getElementById("chatMessages");
        const isSelf = sender === currentUser;

        const msgDiv = document.createElement("div");
        msgDiv.className = `chat-message ${isSelf ? 'self' : 'other'}`;
        msgDiv.innerHTML = `<span class="author">${sender}</span>${text}`;
        
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    document.getElementById("sendMsgBtn").onclick = sendMessage;
    document.getElementById("chatInput").onkeypress = (e) => { if(e.key === "Enter") sendMessage(); };

    function sendMessage() {
        const input = document.getElementById("chatInput");
        const text = input.value.trim();
        if(!text || !ws) return;

        ws.send(JSON.stringify({sender: currentUser, text: text}));
        input.value = "";
    }

    document.getElementById("closeOrderBtn").onclick = async () => {
        await fetch('/api/orders/close', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({order_id: activeOrderId})
        });

        alert("Η παραγγελία έκλεισε επιτυχώς.");
        chatModal.classList.remove("active");
        document.getElementById("openChatBtn").classList.add("hidden");
        if(ws) ws.close();
    };
});