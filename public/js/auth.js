// Shared auth + mobile drawer — runs on every page

document.addEventListener('DOMContentLoaded', () => {
  if (window._authInitialized) return;
  window._authInitialized = true;

  const userId = localStorage.getItem('pp240_userId');
  const name   = localStorage.getItem('pp240_name');

  // ── Mobile drawer ──────────────────────────────────────────────────────────
  const hamburger     = document.getElementById('navHamburger');
  const drawerOverlay = document.getElementById('navDrawerOverlay');
  const drawer        = document.getElementById('navDrawer');
  const drawerClose   = document.getElementById('navDrawerClose');

  function openDrawer() {
    drawerOverlay?.classList.add('open');
    drawer?.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    drawerOverlay?.classList.remove('open');
    drawer?.classList.remove('open');
    document.body.style.overflow = '';
  }

  hamburger?.addEventListener('click', openDrawer);
  drawerOverlay?.addEventListener('click', closeDrawer);
  drawerClose?.addEventListener('click', closeDrawer);

  // Mark active drawer link
  if (drawer) {
    const page = location.pathname.split('/').pop() || 'index.html';
    drawer.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (href === page || (page === '' && href === 'index.html')) a.classList.add('active');
    });
    drawer.querySelectorAll('.nav-drawer-links a').forEach(a =>
      a.addEventListener('click', closeDrawer)
    );
  }

  // ── Desktop nav member link ────────────────────────────────────────────────
  const link         = document.getElementById('navMemberLink');
  const drawerFooter = document.getElementById('navDrawerUser');

  if (!link) return;

  if (userId && name) {
    // ── Logout helpers (defined before first use) ─────────────────────────
    const performLogout = async () => {
      try { await API.logout(); } catch {}
      Session.clear();
      location.reload();
    };

    const doLogout = () => {
      const modal = document.getElementById('logoutModal');
      if (modal) modal.classList.add('open');
      else performLogout();
    };

    // ── Logged in ────────────────────────────────────────────────────────────
    link.innerHTML     = '<i class="fa-solid fa-user"></i> ' + name;
    link.href          = 'member.html?id=' + userId;
    link.style.display = 'flex';

    // Admin link — only rendered for admin accounts.
    API.me().then(me => {
      if (!me || !me.isAdmin) return;
      if (!document.getElementById('navAdminLink')) {
        const a = document.createElement('a');
        a.id = 'navAdminLink';
        a.href = 'admin.html';
        a.innerHTML = '<i class="fa-solid fa-sliders"></i> Admin';
        if (location.pathname.endsWith('admin.html')) a.className = 'active';
        link.insertAdjacentElement('beforebegin', a);
      }
    }).catch(() => {});

    const logoutBtn = document.createElement('button');
    logoutBtn.textContent      = 'Log out';
    logoutBtn.className        = 'btn btn-outline btn-sm';
    logoutBtn.style.marginLeft = '4px';
    logoutBtn.addEventListener('click', doLogout);
    link.insertAdjacentElement('afterend', logoutBtn);

    if (drawerFooter) {
      const profileLink = document.createElement('a');
      profileLink.innerHTML = '<i class="fa-solid fa-user"></i> ' + name;
      profileLink.href      = 'member.html?id=' + userId;
      profileLink.addEventListener('click', closeDrawer);

      const drawerLogout = document.createElement('button');
      drawerLogout.textContent = 'Log out';
      drawerLogout.className   = 'btn btn-outline btn-sm btn-full';
      drawerLogout.addEventListener('click', doLogout);

      drawerFooter.appendChild(profileLink);
      drawerFooter.appendChild(drawerLogout);
    }

    // ── Logout confirmation modal ──────────────────────────────────────────
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="logoutModal">
        <div class="modal" style="max-width:360px;">
          <h2><i class="fa-solid fa-right-from-bracket"></i> Log out?</h2>
          <p style="margin-bottom:20px;color:var(--text-muted);">Are you sure you want to sign out?</p>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-danger btn-full" id="logoutConfirmBtn">Log out</button>
            <button class="btn btn-outline btn-full" id="logoutCancelBtn">Cancel</button>
          </div>
        </div>
      </div>`);

    document.getElementById('logoutConfirmBtn').addEventListener('click', performLogout);
    document.getElementById('logoutCancelBtn').addEventListener('click', () => {
      document.getElementById('logoutModal').classList.remove('open');
    });
    document.getElementById('logoutModal').addEventListener('click', e => {
      if (e.target === document.getElementById('logoutModal'))
        document.getElementById('logoutModal').classList.remove('open');
    });

  } else {
    // ── Logged out ───────────────────────────────────────────────────────────
    const signInBtn = document.createElement('button');
    signInBtn.textContent      = 'Sign in';
    signInBtn.className        = 'btn btn-outline btn-sm';
    signInBtn.style.marginLeft = '4px';
    signInBtn.addEventListener('click', () => openAuthModal());
    link.insertAdjacentElement('afterend', signInBtn);

    // Inject modal
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="navAuthModal">
        <div class="modal">

          <!-- ── Sign in / Sign up view ── -->
          <div id="navAuthSigninView">
            <h2><i class="fa-regular fa-futbol"></i> Sign In</h2>
            <p>Sign in with your email and password. New players need an invite code to create an account.</p>
            <div id="navAuthError" class="error-msg hidden"></div>
            <div class="form-group">
              <label for="navAuthName">Display name <span style="color:var(--muted);font-size:11px;">(new accounts only)</span></label>
              <input type="text" id="navAuthName" placeholder="e.g. Gary" maxlength="30" autocomplete="off">
            </div>
            <div class="form-group">
              <label for="navAuthEmail">Email address</label>
              <input type="email" id="navAuthEmail" placeholder="you@example.com" autocomplete="email">
            </div>
            <div class="form-group">
              <label for="navAuthPassword">Password <span style="color:var(--muted);font-size:11px;">(min. 8 characters)</span></label>
              <input type="password" id="navAuthPassword" placeholder="Your password" autocomplete="current-password">
              <small><a href="#" id="navForgotLink" style="color:var(--accent);">Forgot password?</a></small>
            </div>
            <div class="form-group">
              <label for="navAuthCode">Invite code <span style="color:var(--muted);font-size:11px;">(new accounts only — leave blank to sign in)</span></label>
              <input type="text" id="navAuthCode" placeholder="e.g. Robin Van Shearer" autocomplete="off">
            </div>
            <details style="margin-bottom:12px;">
              <summary style="cursor:pointer;font-size:12px;color:var(--muted);user-select:none;">Had a PIN-based account? Click to claim it</summary>
              <div style="margin-top:8px;">
                <div class="form-group" style="margin-bottom:0;">
                  <label for="navAuthLegacyPin">Old 4-digit PIN</label>
                  <input type="number" id="navAuthLegacyPin" placeholder="e.g. 1234" min="1000" max="9999" inputmode="numeric">
                  <small>Enter your old PIN along with your name above to keep your previous predictions.</small>
                </div>
              </div>
            </details>
            <button class="btn btn-primary btn-full" id="navAuthSubmit">Sign in →</button>
            <button class="btn btn-outline btn-full" id="navAuthCancel" style="margin-top:8px;">Cancel</button>
          </div>

          <!-- ── Forgot password view ── -->
          <div id="navAuthForgotView" style="display:none;">
            <h2><i class="fa-solid fa-key"></i> Forgot Password</h2>
            <p>Enter your email address and we'll send you a link to reset your password.</p>
            <div id="navForgotError" class="error-msg hidden"></div>
            <div id="navForgotSuccess" class="hidden" style="color:var(--accent);font-size:14px;margin-bottom:12px;padding:10px 12px;border:1px solid var(--accent);border-radius:var(--radius-sm);background:var(--accent-dim);">
              <i class="fa-solid fa-circle-check"></i> Check your inbox — a reset link is on its way.
            </div>
            <div class="form-group" id="navForgotEmailGroup">
              <label for="navForgotEmail">Email address</label>
              <input type="email" id="navForgotEmail" placeholder="you@example.com" autocomplete="email">
            </div>
            <button class="btn btn-primary btn-full" id="navForgotSubmit">Send reset link →</button>
            <button class="btn btn-outline btn-full" id="navForgotBack" style="margin-top:8px;">← Back to sign in</button>
          </div>

        </div>
      </div>`);

    const modal         = document.getElementById('navAuthModal');
    const signinView    = document.getElementById('navAuthSigninView');
    const forgotView    = document.getElementById('navAuthForgotView');
    const nameInput     = document.getElementById('navAuthName');
    const emailInput    = document.getElementById('navAuthEmail');
    const passwordInput = document.getElementById('navAuthPassword');
    const codeInput     = document.getElementById('navAuthCode');
    const submitBtn     = document.getElementById('navAuthSubmit');
    const cancelBtn     = document.getElementById('navAuthCancel');
    const errorEl       = document.getElementById('navAuthError');

    function openAuthModal() {
      nameInput.value     = '';
      emailInput.value    = '';
      passwordInput.value = '';
      codeInput.value     = '';
      errorEl.classList.add('hidden');
      showSignin();
      modal.classList.add('open');
      setTimeout(() => emailInput.focus(), 50);
    }
    function closeAuthModal() { modal.classList.remove('open'); }
    function showSignin()     { signinView.style.display = ''; forgotView.style.display = 'none'; }
    function showForgot()     { signinView.style.display = 'none'; forgotView.style.display = ''; setTimeout(() => document.getElementById('navForgotEmail').focus(), 50); }

    cancelBtn.addEventListener('click', closeAuthModal);
    document.getElementById('navForgotLink').addEventListener('click', e => { e.preventDefault(); showForgot(); });
    document.getElementById('navForgotBack').addEventListener('click', e => { e.preventDefault(); showSignin(); });

    // Tab flow
    nameInput.addEventListener('keydown',     e => { if (e.key === 'Enter') emailInput.focus(); });
    emailInput.addEventListener('keydown',    e => { if (e.key === 'Enter') passwordInput.focus(); });
    passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') codeInput.focus(); });
    codeInput.addEventListener('keydown',     e => { if (e.key === 'Enter') submitBtn.click(); });

    // Sign in / sign up
    submitBtn.addEventListener('click', async () => {
      const n  = nameInput.value.trim();
      const em = emailInput.value.trim();
      const pw = passwordInput.value.trim();
      const ac = codeInput.value.trim() || null;
      const lp = document.getElementById('navAuthLegacyPin')?.value.trim() || null;
      errorEl.classList.add('hidden');

      if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { showNavErr('Please enter a valid email address.'); return; }
      if (!pw || pw.length < 8) { showNavErr('Password must be at least 8 characters.'); return; }

      submitBtn.disabled    = true;
      submitBtn.textContent = 'Signing in…';
      try {
        const data = await API.register(n, em, pw, lp || null, ac);
        Session.save(data.userId, data.name, data.token);
        location.reload();
      } catch (e) {
        let msg = 'Could not reach server. Is it running?';
        try { const d = JSON.parse(e.message); msg = d.error || msg; } catch {}
        showNavErr(msg);
        submitBtn.disabled    = false;
        submitBtn.textContent = 'Sign in →';
      }
    });

    function showNavErr(msg) {
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    }

    // Forgot password
    document.getElementById('navForgotSubmit').addEventListener('click', async () => {
      const em     = document.getElementById('navForgotEmail').value.trim();
      const errEl2 = document.getElementById('navForgotError');
      errEl2.classList.add('hidden');
      if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
        errEl2.textContent = 'Please enter a valid email address.';
        errEl2.classList.remove('hidden');
        return;
      }
      const btn = document.getElementById('navForgotSubmit');
      btn.disabled    = true;
      btn.textContent = 'Sending…';
      try {
        await API.forgotPassword(em);
      } catch (e) {
        let msg = 'Could not send email. Please try again.';
        try { const d = JSON.parse(e.message); msg = d.error || msg; } catch {}
        errEl2.textContent = msg;
        errEl2.classList.remove('hidden');
        btn.disabled    = false;
        btn.textContent = 'Send reset link →';
        return;
      }
      document.getElementById('navForgotSuccess').classList.remove('hidden');
      document.getElementById('navForgotEmailGroup').style.display = 'none';
      btn.style.display = 'none';
    });

    // Drawer footer: sign-in button
    if (drawerFooter) {
      const drawerSignIn = document.createElement('button');
      drawerSignIn.textContent = 'Sign in';
      drawerSignIn.className   = 'btn btn-outline btn-sm btn-full';
      drawerSignIn.addEventListener('click', () => { closeDrawer(); openAuthModal(); });
      drawerFooter.appendChild(drawerSignIn);
    }
  }

});
