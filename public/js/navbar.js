/**
 * RUAA Global Navbar Component
 * Injects a floating, interactive, responsive navbar into every page.
 * Features: scroll-aware glass blur, active page detection, mobile drawer, 
 * scroll-spy for anchor links.
 */
(function () {
  const NAV_LINKS = [
    { label: 'الرئيسية',   href: '/',             page: 'index'    },
    { label: 'خدماتنا',    href: '/services.html', page: 'services' },
    { label: 'كيف تعمل',   href: '/#vision',       page: null       },
    { label: 'عن المنصة',  href: '/#goals',        page: null       },
    { label: 'تواصل معنا', href: '/#about',        page: null       },
  ];

  // Detect which page we're on
  const currentPath = window.location.pathname;
  function isActive(link) {
    if (link.page === 'index') return currentPath === '/' || currentPath === '/index.html';
    if (link.page === 'services') return currentPath === '/services.html';
    return false;
  }

  // Build nav link HTML
  function buildLink(link) {
    const active = isActive(link);
    if (active) {
      return `
        <a href="${link.href}" class="ruaa-nav-link ruaa-nav-active flex items-center gap-2 text-white bg-white/10 px-4 py-2 rounded-full font-bold shadow-inner border border-white/5 transition-all text-[13px] whitespace-nowrap">
          ${link.label}
          <span class="w-1.5 h-1.5 rounded-full bg-[#dfb867] flex-shrink-0" style="box-shadow:0 0 8px rgba(223,184,103,0.9)"></span>
        </a>`;
    }
    return `
      <a href="${link.href}" class="ruaa-nav-link text-white/70 hover:text-white hover:bg-white/5 px-4 py-2 rounded-full font-semibold transition-all text-[13px] whitespace-nowrap">
        ${link.label}
      </a>`;
  }

  // Build mobile drawer link
  function buildMobileLink(link) {
    const active = isActive(link);
    return `
      <a href="${link.href}" class="ruaa-nav-link flex items-center justify-between gap-3 px-4 py-3 rounded-xl transition-all ${active ? 'bg-white/10 text-white font-bold' : 'text-white/70 hover:text-white hover:bg-white/5 font-semibold'}">
        <span>${link.label}</span>
        ${active ? '<span class="w-2 h-2 rounded-full bg-[#dfb867] flex-shrink-0" style="box-shadow:0 0 8px rgba(223,184,103,0.9)"></span>' : ''}
      </a>`;
  }

  const navHTML = `
    <div id="ruaa-navbar" class="fixed top-5 left-1/2 z-[999] transition-all duration-500" style="transform: translateX(-50%); width: auto; max-width: calc(100vw - 2rem);">
      
      <!-- Desktop Pill -->
      <div id="ruaa-nav-pill" class="hidden md:flex items-center gap-1 px-6 py-2 rounded-full border border-white/5 transition-all duration-500"
           style="background: rgba(18,34,53,0.7); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); box-shadow: 0 8px 32px rgba(0,0,0,0.25);">
        
        ${NAV_LINKS.map(buildLink).join('')}

        <div class="w-px h-5 bg-white/10 mx-1 flex-shrink-0"></div>

        <a href="/login.html" class="ruaa-login-btn group relative flex items-center gap-2 px-4 py-2 flex-shrink-0">
          <div class="absolute inset-0 rounded-full transition-opacity duration-300 opacity-0 group-hover:opacity-100" style="background: rgba(223,184,103,0.12); filter: blur(8px);"></div>
          <span class="relative text-[#dfb867] font-bold text-[13px] group-hover:text-[#f8d07a] transition-colors" style="text-shadow: 0 0 12px rgba(223,184,103,0.2);">تسجيل الدخول</span>
          <svg class="relative w-3.5 h-3.5 text-[#dfb867] group-hover:text-[#f8d07a] transition-all duration-300 group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
          </svg>
        </a>
      </div>

      <!-- Mobile Toggle Button -->
      <button id="ruaa-mobile-toggle" class="md:hidden flex items-center gap-3 px-5 py-3 rounded-2xl border border-white/5 transition-all"
              style="background: rgba(18,34,53,0.85); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px); box-shadow: 0 8px 32px rgba(0,0,0,0.3);">
        <span class="text-[#dfb867] font-black text-lg tracking-wider" style="background: linear-gradient(to left, #ba8c3e, #f8d07a); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">رُؤى</span>
        <div class="w-px h-4 bg-white/10"></div>
        <svg id="ruaa-hamburger-icon" class="w-5 h-5 text-white transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path id="ruaa-hamburger-path" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
        </svg>
      </button>
    </div>

    <!-- Mobile Drawer Overlay -->
    <div id="ruaa-mobile-overlay" class="fixed inset-0 z-[998] opacity-0 pointer-events-none transition-opacity duration-300" style="background: rgba(11,21,33,0.8); backdrop-filter: blur(4px);"></div>

    <!-- Mobile Drawer -->
    <div id="ruaa-mobile-drawer" class="fixed top-0 right-0 bottom-0 z-[999] w-[280px] transition-transform duration-300 flex flex-col" 
         style="transform: translateX(100%); background: rgba(18,34,53,0.97); backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px); border-left: 1px solid rgba(255,255,255,0.05); box-shadow: -20px 0 60px rgba(0,0,0,0.5);">
      
      <!-- Drawer Header -->
      <div class="flex items-center justify-between p-6 border-b" style="border-color: rgba(255,255,255,0.05);">
        <a href="/" style="background: linear-gradient(to left, #ba8c3e, #f8d07a); -webkit-background-clip: text; -webkit-text-fill-color: transparent;" class="text-2xl font-black tracking-widest">رُؤى</a>
        <button id="ruaa-drawer-close" class="p-2 rounded-xl text-white/50 hover:text-white hover:bg-white/5 transition-all">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <!-- Drawer Links -->
      <nav class="flex-1 overflow-y-auto p-4 flex flex-col gap-1">
        ${NAV_LINKS.map(buildMobileLink).join('')}
      </nav>

      <!-- Drawer Footer -->
      <div class="p-4 border-t" style="border-color: rgba(255,255,255,0.05);">
        <a href="/login.html" class="flex items-center justify-center gap-2 w-full py-3 px-6 rounded-xl font-bold text-[14px] transition-all hover:-translate-y-0.5"
           style="background: linear-gradient(to left, #ba8c3e, #f8d07a); color: #0a111a; box-shadow: 0 0 20px rgba(223,184,103,0.25);">
          تسجيل الدخول
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/>
          </svg>
        </a>
      </div>
    </div>
  `;

  // Inject navbar
  document.body.insertAdjacentHTML('afterbegin', navHTML);

  // ── Scroll-Aware Pill Styling ──────────────────────────────────────────────
  const pill = document.getElementById('ruaa-nav-pill');
  const navbar = document.getElementById('ruaa-navbar');
  
  function onScroll() {
    const scrolled = window.scrollY > 40;
    if (pill) {
      pill.style.background = scrolled
        ? 'rgba(12,22,36,0.92)'
        : 'rgba(18,34,53,0.7)';
      pill.style.boxShadow = scrolled
        ? '0 12px 40px rgba(0,0,0,0.5)'
        : '0 8px 32px rgba(0,0,0,0.25)';
      pill.style.borderColor = scrolled
        ? 'rgba(255,255,255,0.08)'
        : 'rgba(255,255,255,0.05)';
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ── Mobile Drawer Toggle ───────────────────────────────────────────────────
  const mobileToggle = document.getElementById('ruaa-mobile-toggle');
  const mobileDrawer = document.getElementById('ruaa-mobile-drawer');
  const mobileOverlay = document.getElementById('ruaa-mobile-overlay');
  const drawerClose = document.getElementById('ruaa-drawer-close');
  const hamburgerPath = document.getElementById('ruaa-hamburger-path');
  let drawerOpen = false;

  function openDrawer() {
    drawerOpen = true;
    mobileDrawer.style.transform = 'translateX(0)';
    mobileOverlay.style.opacity = '1';
    mobileOverlay.style.pointerEvents = 'auto';
    document.body.style.overflow = 'hidden';
    hamburgerPath.setAttribute('d', 'M6 18L18 6M6 6l12 12');
  }

  function closeDrawer() {
    drawerOpen = false;
    mobileDrawer.style.transform = 'translateX(100%)';
    mobileOverlay.style.opacity = '0';
    mobileOverlay.style.pointerEvents = 'none';
    document.body.style.overflow = '';
    hamburgerPath.setAttribute('d', 'M4 6h16M4 12h16M4 18h16');
  }

  mobileToggle?.addEventListener('click', () => drawerOpen ? closeDrawer() : openDrawer());
  drawerClose?.addEventListener('click', closeDrawer);
  mobileOverlay?.addEventListener('click', closeDrawer);

  // Close drawer when a link is clicked
  document.querySelectorAll('.ruaa-nav-link').forEach(link => {
    link.addEventListener('click', () => {
      if (drawerOpen) closeDrawer();
    });
  });

  // ── Keyboard Accessibility ─────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerOpen) closeDrawer();
  });

  // ── Motif Parallax Scroll ─────────────────────────────────────────────────
  const motif = document.getElementById('ruaa-motif');
  if (motif) {
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          // Scroll upward at 40% of scroll speed for a natural parallax feel
          const offset = -(window.scrollY * 0.4);
          motif.style.backgroundPositionY = `${offset}px`;
          ticking = false;
        });
        ticking = true;
      }
    }, { passive: true });
  }

})();
