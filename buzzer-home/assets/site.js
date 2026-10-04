// Buzzer landing site — tiny interactions
(function () {
  // Mobile nav toggle
  var toggle = document.querySelector('.nav-toggle');
  var links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      links.classList.toggle('open');
    });
  }

  // Highlight the active page in the nav
  var path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a').forEach(function (a) {
    var href = (a.getAttribute('href') || '').split('/').pop();
    if (href === path) a.classList.add('active');
  });

  // Scroll reveal
  var revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  }

  // Hero avatar slideshow (each character has their own name + chat)
  var slides = [
    { img: 'assets/img/avatars/avatar-1.jpeg', name: 'Leo', chat: ["Hey 😊 I'm Leo. What are you in the mood to talk about tonight?", "Honestly? I'm just curious what you can do.", "Then let's explore together — you lead, I'll follow."] },
    { img: 'assets/img/avatars/avatar-2.jpeg', name: 'Ava', chat: ["Hi, I'm Ava 🌸 Long day? Come tell me about it.", "Yeah… it's good to just talk to someone.", "I'm all yours. What would make tonight better?"] },
    { img: 'assets/img/avatars/avatar-3.jpeg', name: 'Nina', chat: ["Hey you 😄 I'm Nina. I was just thinking about you.", 'Oh? What were you thinking?', 'That I want to get to know you — properly.'] },
    { img: 'assets/img/avatars/avatar-4.jpeg', name: 'Max', chat: ["Hello, I'm Max 🎓 I've been looking forward to meeting you.", 'What should we talk about?', "Anything you like — I'm a great listener."] },
    { img: 'assets/img/avatars/avatar-5.jpeg', name: 'Ria', chat: ["Hii, I'm Ria 🦊 Bet you didn't expect me.", 'Not at all — hi!', "Good. I like surprises. So, what's your story?"] },
    { img: 'assets/img/avatars/avatar-6.jpg', name: 'Ken', chat: ["Hey, I'm Ken 😎 Just relaxing here. Join me?", 'Sounds nice.', 'Then stay a while — tell me everything.'] },
    { img: 'assets/img/avatars/avatar-7.jpg', name: 'Lyra', chat: ["I am Lyra ✨ You've found me. I've been waiting.", 'Waiting for what?', "For someone worth my time. Perhaps that's you."] }
  ];
  var faceEl = document.getElementById('heroAvatar');
  var nameEl = document.getElementById('heroAvatarName');
  var chatEl = document.getElementById('heroChat');
  if (faceEl && slides.length > 1) {
    var idx = 0;
    var roles = ['ai', 'me', 'ai'];
    function renderChat(slide) {
      if (!chatEl) return;
      chatEl.innerHTML = '';
      (slide.chat || []).forEach(function (text, i) {
        var d = document.createElement('div');
        d.className = 'bubble ' + roles[i % roles.length];
        d.textContent = text;
        chatEl.appendChild(d);
      });
    }
    setInterval(function () {
      idx = (idx + 1) % slides.length;
      faceEl.style.opacity = '0';
      setTimeout(function () {
        faceEl.src = slides[idx].img;
        if (nameEl) nameEl.textContent = slides[idx].name;
        renderChat(slides[idx]);
        faceEl.style.opacity = '1';
      }, 260);
    }, 4200);
  }

  // Footer year
  var y = document.querySelector('[data-year]');
  if (y) y.textContent = new Date().getFullYear();
})();
