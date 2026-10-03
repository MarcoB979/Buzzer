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

  // Hero avatar slideshow
  var slides = [
    { img: 'assets/img/avatars/avatar-1.jpeg', name: 'Leo' },
    { img: 'assets/img/avatars/avatar-2.jpeg', name: 'Ava' },
    { img: 'assets/img/avatars/avatar-3.jpeg', name: 'Nina' }
  ];
  var faceEl = document.getElementById('heroAvatar');
  var nameEl = document.getElementById('heroAvatarName');
  if (faceEl && slides.length > 1) {
    var idx = 0;
    setInterval(function () {
      idx = (idx + 1) % slides.length;
      faceEl.style.opacity = '0';
      setTimeout(function () {
        faceEl.src = slides[idx].img;
        if (nameEl) nameEl.textContent = slides[idx].name;
        faceEl.style.opacity = '1';
      }, 260);
    }, 3000);
  }

  // Footer year
  var y = document.querySelector('[data-year]');
  if (y) y.textContent = new Date().getFullYear();
})();
