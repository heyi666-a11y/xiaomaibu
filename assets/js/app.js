/* ============================================================================
   印相便利店 · 买家端逻辑
   ========================================================================== */

const state = {
  products: [],
  settings: {},
  category: '全部',
  keyword: '',
  unitChoice: {},   // product_id -> 'bottle' | 'box'
  tab: 'shop',
  orders: [],
  seckills: []
};

/* ---------------------------------------------------------------- 初始化 */
async function boot() {
  bindShell();
  renderCart();
  renderMe();
  switchTab('shop');

  try {
    const [settings, products, seckills] = await Promise.all([
      yxlsRpc('yxls_public_settings'),
      yxlsRpc('yxls_products', { p_category: null }),
      yxlsRpc('yxls_seckill_list')
    ]);
    state.settings = settings || {};
    state.products = products || [];
    state.seckills = seckills || [];
    window.__yxlsProducts = state.products;
    applySettings();
    renderCategories();
    renderProducts();
    renderSeckill();
    startSeckillTicker();
  } catch (err) {
    document.getElementById('productGrid').innerHTML =
      `<div class="empty" style="grid-column:1/-1">
         <strong>加载失败</strong>
         ${escapeHtml(err.message)}<br><span class="small">请确认后台 SQL 已执行，或稍后重试</span>
       </div>`;
  }
}

function applySettings() {
  const s = state.settings;
  if (s.shop_name) {
    document.getElementById('shopName').textContent = s.shop_name;
    document.title = s.shop_name + ' · 在线选购';
  }
  if (s.open_hours) document.getElementById('shopHours').textContent = '营业时间 ' + s.open_hours;
  if (s.notice) document.getElementById('noticeText').textContent = s.notice;
  if (s.contact_phone) document.getElementById('meContact').textContent = s.contact_phone;
  if (s.footer_note) {
    const p = document.createElement('p');
    p.className = 'hint center';
    p.style.marginTop = '22px';
    p.textContent = s.footer_note;
    document.querySelector('#viewMe').appendChild(p);
  }
}

/* ---------------------------------------------------------------- 商品 */
function renderCategories() {
  const cats = ['全部', ...Array.from(new Set(state.products.map(p => p.category).filter(Boolean)))];
  document.getElementById('categoryChips').innerHTML = cats.map(c =>
    `<button class="chip ${c === state.category ? 'active' : ''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`
  ).join('');
  document.getElementById('categoryChips').onclick = e => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    state.category = b.dataset.cat;
    renderCategories();
    renderProducts();
  };
}

function visibleProducts() {
  const kw = state.keyword.trim().toLowerCase();
  return state.products.filter(p => {
    if (state.category !== '全部' && p.category !== state.category) return false;
    if (!kw) return true;
    return (p.name + ' ' + (p.barcode || '') + ' ' + (p.spec || '')).toLowerCase().includes(kw);
  });
}

function renderProducts() {
  const list = visibleProducts();
  document.getElementById('productCount').textContent = `共 ${list.length} 款`;
  const grid = document.getElementById('productGrid');

  if (!list.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><strong>没有找到商品</strong>换个关键词或分类试试</div>`;
    return;
  }

  grid.innerHTML = list.map(p => {
    const unit = state.unitChoice[p.id] || 'bottle';
    const price = unit === 'box' ? p.box_price : p.bottle_price;
    const boxSave = Number(p.box_price) > 0 && Number(p.bottle_price) * p.bottle_count > Number(p.box_price);
    const out = Number(p.stock_bottles) <= 0;
    const few = !out && Number(p.stock_bottles) < p.bottle_count;

    return `
    <article class="product">
      <div class="product-media">
        <img src="${productImage(p)}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="imgFallback(this)">
        <span class="product-tag">${escapeHtml(p.category || '在售')}</span>
      </div>
      <div class="product-body">
        <div class="product-name">${escapeHtml(p.name)}</div>
        <div class="product-meta">${escapeHtml(p.spec || '')} · ${p.bottle_count} 瓶/箱</div>
        <div class="price-row">
          <span class="price">${yuan(price)}</span>
          <span class="price-unit">/ ${unit === 'box' ? '箱' : '瓶'}</span>
          ${boxSave ? `<span class="price-old">${yuan(unit === 'box' ? p.bottle_price * p.bottle_count : 0)}</span>` : ''}
        </div>
        ${out
          ? `<div class="stock-out">暂时缺货</div>`
          : `<div class="product-meta">库存 ${p.stock_bottles} 瓶${few ? '（不足一箱）' : ''}</div>`}
        <div class="product-actions">
          <div class="unit-toggle">
            <button data-unit="bottle" data-id="${p.id}" class="${unit === 'bottle' ? 'active' : ''}">单瓶</button>
            <button data-unit="box" data-id="${p.id}" class="${unit === 'box' ? 'active' : ''}">整箱</button>
          </div>
          <button class="btn btn-primary btn-sm" data-add="${p.id}" ${out ? 'disabled' : ''} style="margin-left:auto">加入</button>
        </div>
      </div>
    </article>`;
  }).join('');
}

document.addEventListener('click', e => {
  const unitBtn = e.target.closest('[data-unit]');
  if (unitBtn) {
    state.unitChoice[unitBtn.dataset.id] = unitBtn.dataset.unit;
    renderProducts();
    return;
  }
  const addBtn = e.target.closest('[data-add]');
  if (addBtn) {
    const p = state.products.find(x => String(x.id) === addBtn.dataset.add);
    if (!p) return;
    const unit = state.unitChoice[p.id] || 'bottle';
    Cart.add(p, unit, 1);
    toast(`已加入：${p.name}（${unitText(unit)}）`, 'ok');
  }
});

/* ---------------------------------------------------------------- 秒杀专区 */
async function loadSeckills() {
  try {
    state.seckills = (await yxlsRpc('yxls_seckill_list')) || [];
    renderSeckill();
  } catch (err) { /* 静默：秒杀不可用不影响主流程 */ }
}

function renderSeckill() {
  renderHomeSeckill();
  const list = state.seckills.filter(s => !s.sold_out);
  const hero = document.getElementById('seckillCountdown');
  if (!state.seckills.length) {
    hero.textContent = '';
    document.getElementById('seckillList').innerHTML =
      `<div class="empty"><strong>暂无秒杀活动</strong>商家上架后这里会第一时间开抢</div>`;
    return;
  }
  hero.textContent = earliestCountdown(state.seckills);

  document.getElementById('seckillList').innerHTML = list.length
    ? list.map(sk => {
        const off = sk.origin_price > 0 && Number(sk.seckill_price) < Number(sk.origin_price)
          ? Math.round((Number(sk.seckill_price) / Number(sk.origin_price)) * 100) / 10
          : 0;
        const pct = Math.min(100, Number(sk.sold_percent) || 0);
        const unitName = sk.unit === 'box' ? '箱' : '瓶';
        const showLeft = sk.left_show;
        const stockOut = Number(sk.stock_bottles) <= 0;
        return `
        <article class="sk-card">
          <img class="sk-img" src="${productImage(sk)}" alt="${escapeHtml(sk.name)}" loading="lazy" onerror="imgFallback(this)">
          <div class="sk-main">
            <div class="sk-title">
              <span class="sk-badge">秒杀</span>
              ${escapeHtml(sk.title || sk.name)}
            </div>
            <div class="muted small">${escapeHtml(sk.spec || '')} · ${unitName} · 限量 ${sk.stock_show} ${unitName}</div>
            <div class="sk-price-row">
              <span class="sk-price">${yuan(sk.seckill_price)}</span>
              <span class="price-old">${yuan(sk.origin_price)}</span>
              ${off > 0 ? `<span class="sk-off">${off}折</span>` : ''}
              <span class="sk-end muted small" data-sk-end="${sk.end_at || ''}" style="margin-left:auto">
                ${countdownText(sk.end_at).text}
              </span>
            </div>
            <div class="sk-progress"><i style="width:${pct}%"></i></div>
            <div class="sk-foot">
              <span class="muted small">仅剩 <b style="color:var(--accent)">${showLeft}</b> ${unitName}</span>
              <button class="btn btn-accent btn-sm" data-sk-add="${sk.id}" ${stockOut || showLeft <= 0 ? 'disabled' : ''}>
                ${stockOut ? '商品缺货' : showLeft <= 0 ? '已抢完' : '马上抢'}
              </button>
            </div>
          </div>
        </article>`;
      }).join('')
    : `<div class="empty"><strong>本轮已抢完</strong>等下一波秒杀再来吧</div>`;
}

/* 首页秒杀横条：有在售活动才显示，横滑卡片，点击进入秒杀页 */
function renderHomeSeckill() {
  const box = document.getElementById('homeSeckill');
  if (!box) return;
  const list = state.seckills.filter(s => !s.sold_out);
  if (!list.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  document.getElementById('hsCountdown').textContent = earliestCountdown(list);
  document.getElementById('hsList').innerHTML = list.map(sk => {
    const off = sk.origin_price > 0 && Number(sk.seckill_price) < Number(sk.origin_price)
      ? Math.round((Number(sk.seckill_price) / Number(sk.origin_price)) * 100) / 10
      : 0;
    const pct = Math.min(100, Number(sk.sold_percent) || 0);
    const out = Number(sk.stock_bottles) <= 0 || sk.left_show <= 0;
    return `
    <div class="hs-card${out ? ' is-out' : ''}" data-hs-go>
      <img src="${productImage(sk)}" alt="${escapeHtml(sk.name)}" loading="lazy" onerror="imgFallback(this)">
      <div class="hs-name">${escapeHtml(sk.name)}</div>
      <div class="hs-price">${yuan(sk.seckill_price)}${off > 0 ? `<em>${off}折</em>` : ''}</div>
      <div class="hs-bar"><i style="width:${pct}%"></i></div>
      <div class="hs-flag">${out ? '已抢完' : '马上抢'}</div>
    </div>`;
  }).join('');
}

function earliestCountdown(sks) {
  const ends = sks.map(s => s.end_at ? new Date(s.end_at).getTime() : Infinity);
  if (!ends.length) return '--:--:--';
  const min = Math.min(...ends);
  if (min === Infinity) return '长期有效';
  return '距结束 ' + countdownText(new Date(min).toISOString()).text;
}

/* 每秒刷新倒计时；整点结束后自动重拉列表 */
function startSeckillTicker() {
  if (startSeckillTicker._t) clearInterval(startSeckillTicker._t);
  startSeckillTicker._t = setInterval(() => {
    const sks = state.seckills;
    if (!sks.length) return;
    if (state.tab === 'seckill') {
      document.getElementById('seckillCountdown').textContent = earliestCountdown(sks);
      document.querySelectorAll('[data-sk-end]').forEach(el => {
        el.textContent = countdownText(el.dataset.skEnd || null).text;
      });
    } else {
      /* 首页横条倒计时也保持走秒 */
      const hs = document.getElementById('hsCountdown');
      const active = sks.filter(s => !s.sold_out);
      if (hs && active.length) hs.textContent = earliestCountdown(active);
    }
    if (sks.some(s => s.end_at && new Date(s.end_at).getTime() <= Date.now())) loadSeckills();
  }, 1000);
}

document.addEventListener('click', e => {
  /* 首页秒杀横条：点击任意卡片进入秒杀页 */
  if (e.target.closest('[data-hs-go]')) { switchTab('seckill'); return; }
  const btn = e.target.closest('[data-sk-add]');
  if (!btn) return;
  const sk = state.seckills.find(s => String(s.id) === btn.dataset.skAdd);
  if (!sk) return;
  /* 同一秒杀活动在购物车里的数量不能超过剩余可抢名额 */
  const inCart = Cart.read()
    .filter(i => i.seckill_id === sk.id)
    .reduce((s, i) => s + i.qty, 0);
  if (inCart >= sk.seckill_left) { toast(`该秒杀每人限抢 ${sk.seckill_left} ${sk.unit === 'box' ? '箱' : '瓶'}`, 'err'); return; }

  /* 合成商品对象：按活动单位把原价映射到对应字段，供购物车展示原价 */
  const prod = {
    id: sk.product_id,
    barcode: sk.barcode,
    name: sk.name,
    spec: sk.spec,
    bottle_count: sk.bottle_count,
    bottle_price: sk.unit === 'bottle' ? sk.origin_price : Number(sk.origin_price) / sk.bottle_count,
    box_price: sk.unit === 'box' ? sk.origin_price : Number(sk.origin_price) * sk.bottle_count
  };
  Cart.add(prod, sk.unit, 1, sk);
  toast(`秒杀已加入：${sk.name}`, 'ok');
});

/* ---------------------------------------------------------------- 购物车 */
function renderCart() {
  const n = Cart.count;
  const dot = document.getElementById('cartDot');
  dot.textContent = n > 99 ? '99+' : n;
  dot.classList.toggle('hidden', n === 0);

  const bar = document.getElementById('cartBar');
  bar.classList.toggle('hidden', n === 0);
  document.getElementById('cartBarSub').textContent = `共 ${n} 件`;
  document.getElementById('cartBarTotal').textContent = yuan(Cart.amount);
}
window.addEventListener('yxls:cart', renderCart);

function openCart() {
  const items = Cart.read();
  if (!items.length) { toast('购物车还是空的'); return; }

  const body = items.map((it, i) => `
    <div class="line-item">
      <img class="line-thumb" src="${productImage({ barcode: it.barcode, name: it.name })}" alt="" onerror="imgFallback(this)">
      <div class="line-main">
        <div class="line-title">
          ${it.seckill_id ? '<span class="sk-badge">秒杀</span>' : ''}${escapeHtml(it.name)}
        </div>
        <div class="line-sub">${escapeHtml(it.spec || '')} · ${unitText(it.unit)} · ${yuan(it.price)}
          ${it.seckill_id && it.origin_price > it.price ? `<span class="price-old">${yuan(it.origin_price)}</span>` : ''}
        </div>
        ${it.seckill_id ? '' : `
        <div class="unit-toggle" style="margin-top:7px">
          <button data-cart-unit="bottle" data-i="${i}" class="${it.unit === 'bottle' ? 'active' : ''}">单瓶</button>
          <button data-cart-unit="box" data-i="${i}" class="${it.unit === 'box' ? 'active' : ''}">整箱</button>
        </div>`}
      </div>
      <div class="line-right">
        <div class="qty">
          <button data-cart-dec="${i}">−</button><span>${it.qty}</span><button data-cart-inc="${i}">+</button>
        </div>
        <strong>${yuan(it.qty * it.price)}</strong>
        <button class="btn btn-sm btn-ghost" data-cart-del="${i}" style="color:var(--ink-3)">删除</button>
      </div>
    </div>`).join('');

  const d = openDrawer({
    title: `购物车（${Cart.count} 件）`,
    body,
    foot: `<button class="btn btn-primary btn-block" data-checkout>去结算 · ${yuan(Cart.amount)}</button>`,
    onMount(el, close) {
      el.addEventListener('click', ev => {
        const t = ev.target;
        if (t.closest('[data-cart-inc]')) { const i = +t.closest('[data-cart-inc]').dataset.cartInc; Cart.setQty(i, Cart.read()[i].qty + 1); close(); openCart(); }
        else if (t.closest('[data-cart-dec]')) { const i = +t.closest('[data-cart-dec]').dataset.cartDec; Cart.setQty(i, Cart.read()[i].qty - 1); close(); openCart(); }
        else if (t.closest('[data-cart-del]')) { Cart.remove(+t.closest('[data-cart-del]').dataset.cartDel); close(); openCart(); }
        else if (t.closest('[data-cart-unit]')) {
          const b = t.closest('[data-cart-unit]');
          Cart.setUnit(+b.dataset.i, b.dataset.cartUnit); close(); openCart();
        } else if (t.closest('[data-checkout]')) { close(); openCheckout(); }
      });
    }
  });
  return d;
}

/* ---------------------------------------------------------------- 登录注册 */
function openAuth(mode = 'login', after) {
  const c = Session.customer;
  mode = c ? mode : (mode === 'register' ? 'register' : 'login');

  const m = openModal({
    title: c ? '账号' : '登录 / 注册',
    body: c ? `
      <div class="center" style="padding:6px 0 14px">
        <div class="avatar" style="margin:0 auto 10px">${escapeHtml((c.nickname || '顾客').slice(0, 1))}</div>
        <div style="font-size:16px;font-weight:600">${escapeHtml(c.nickname || '')}</div>
        <div class="muted small">${escapeHtml(c.phone || '')}</div>
      </div>` : `
      <div class="seg" id="authSeg">
        <button data-mode="login" class="${mode === 'login' ? 'active' : ''}">登录</button>
        <button data-mode="register" class="${mode === 'register' ? 'active' : ''}">注册</button>
      </div>
      <div class="field"><label>手机号</label><input class="input" id="authPhone" inputmode="numeric" maxlength="11" placeholder="11 位手机号" autocomplete="tel"></div>
      <div class="field"><label>密码</label><input class="input" id="authPwd" type="password" placeholder="至少 6 位" autocomplete="current-password"></div>
      <div class="field only-register"><label>昵称</label><input class="input" id="authNick" placeholder="直接写你的微信用户名" maxlength="20"></div>
      <div class="field only-register"><label>邀请码</label><input class="input" id="authInvite" placeholder="请输入商家提供的邀请码" style="text-transform:uppercase"></div>
      <p class="hint only-register">邀请码由商家提供；注册后可用手机号 + 密码登录。</p>`,
    foot: c
      ? `<button class="btn btn-block" data-close>关闭</button><button class="btn btn-primary" id="authLogout">退出登录</button>`
      : `<button class="btn btn-primary btn-block" id="authSubmit">${mode === 'login' ? '登录' : '注册并登录'}</button>`,
    onMount(el, close) {
      const syncMode = () => {
        el.querySelectorAll('.only-register').forEach(n => n.classList.toggle('hidden', mode !== 'register'));
        const b = el.querySelector('#authSubmit');
        if (b) b.textContent = mode === 'register' ? '注册并登录' : '登录';
      };
      if (!c) {
        syncMode();
        el.querySelector('#authSeg').onclick = e => {
          const b = e.target.closest('[data-mode]');
          if (!b) return;
          mode = b.dataset.mode;
          el.querySelectorAll('#authSeg button').forEach(x => x.classList.toggle('active', x === b));
          syncMode();
        };
        const submit = async () => {
          const phone = el.querySelector('#authPhone').value.trim();
          const pwd = el.querySelector('#authPwd').value;
          const invite = (el.querySelector('#authInvite') || {}).value || '';
          const nick = (el.querySelector('#authNick') || {}).value || '';
          const btn = el.querySelector('#authSubmit');
          if (!/^1\d{10}$/.test(phone)) { toast('请输入正确的手机号', 'err'); return; }
          if (pwd.length < 6) { toast('密码至少 6 位', 'err'); return; }
          if (mode === 'register' && !nick.trim()) { toast('请填写昵称', 'err'); return; }
          if (mode === 'register' && !invite.trim()) { toast('请填写邀请码', 'err'); return; }
          btn.disabled = true; btn.textContent = '处理中…';
          try {
            const r = mode === 'register'
              ? await yxlsRpc('yxls_register', { p_phone: phone, p_password: pwd, p_invite: invite.trim(), p_nickname: nick.trim() })
              : await yxlsRpc('yxls_login', { p_phone: phone, p_password: pwd });
            if (!r || !r.ok) throw new Error((r && r.msg) || '操作失败');
            Session.save(r.token, r.customer);
            toast(r.msg || '成功', 'ok');
            close();
            renderMe(); renderCart();
            refreshOrders();
            if (after) after();
          } catch (err) {
            toast(err.message, 'err');
            btn.disabled = false; btn.textContent = mode === 'register' ? '注册并登录' : '登录';
          }
        };
        el.querySelector('#authSubmit').onclick = submit;
        el.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
      } else {
        el.querySelector('#authLogout').onclick = async () => {
          try { await yxlsRpc('yxls_logout', { p_token: Session.token }); } catch (e) { /* 忽略 */ }
          Session.clear();
          close();
          renderMe(); renderCart();
          state.orders = [];
          renderOrders();
          toast('已退出登录', 'ok');
        };
      }
    }
  });
  return m;
}

/* ---------------------------------------------------------------- 结算 */
function openCheckout() {
  if (!Session.isLogin) {
    openAuth('login', () => { if (Session.isLogin) openCheckout(); });
    return;
  }
  const items = Cart.read();
  if (!items.length) { toast('购物车是空的'); return; }
  const c = Session.customer || {};
  const min = Number(state.settings.delivery_min || 0);
  const fee = Number(state.settings.delivery_fee || 0);
  const amount = Cart.amount;
  const below = min > 0 && amount < min;

  openModal({
    title: '确认订单',
    body: `
      <div class="card pad" style="box-shadow:none;background:var(--surface-2);margin-bottom:14px">
        ${items.map(it => `
          <div class="order-item-row">
            <span>${escapeHtml(it.name)} <span class="muted">· ${unitText(it.unit)} × ${it.qty}${it.seckill_id ? ' · 秒杀' : ''}</span></span>
            <strong>${yuan(it.qty * it.price)}</strong>
          </div>`).join('')}
        <div class="order-item-row" style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)">
          <span class="muted">配送费 ${fee > 0 ? yuan(fee) : '免'}</span>
          <span>合计 <b style="font-size:16px">${yuan(amount + fee)}</b></span>
        </div>
      </div>
      <div class="field"><label>联系人</label><input class="input" id="ckContact" value="${escapeHtml(c.contact || c.nickname || '')}" placeholder="可写微信用户名"></div>
      <div class="field"><label>联系电话</label><input class="input" id="ckPhone" inputmode="numeric" value="${escapeHtml(c.phone || '')}" maxlength="11"></div>
      <div class="field"><label>收货地址</label><textarea class="textarea" id="ckAddress" placeholder="小区/楼栋/门牌，或写“到店自提”">${escapeHtml(c.address || '')}</textarea></div>
      <div class="field"><label>备注（选填）</label><input class="input" id="ckRemark" placeholder="如：要冰的、送到前台"></div>
      ${below ? `<p class="hint" style="color:var(--warn)">当前门店起送 ¥${min}，还差 ¥${(min - amount).toFixed(2)}</p>` : ''}`,
    foot: `<button class="btn" data-close>再逛逛</button><button class="btn btn-accent" id="ckSubmit">提交订单</button>`,
    onMount(el, close) {
      const btn = el.querySelector('#ckSubmit');
      btn.onclick = async () => {
        const contact = el.querySelector('#ckContact').value.trim();
        const phone = el.querySelector('#ckPhone').value.trim();
        const address = el.querySelector('#ckAddress').value.trim();
        const remark = el.querySelector('#ckRemark').value.trim();
        if (!contact) { toast('请填写联系人', 'err'); return; }
        if (!/^1\d{10}$/.test(phone)) { toast('请填写正确的联系电话', 'err'); return; }
        if (!address) { toast('请填写收货地址', 'err'); return; }

        btn.disabled = true; btn.textContent = '提交中…';
        try {
          const payload = items.map(i => ({
            product_id: i.product_id,
            unit: i.unit,
            qty: i.qty,
            seckill_id: i.seckill_id || null
          }));
          const r = await yxlsRpc('yxls_order_create', {
            p_token: Session.token,
            p_items: payload,
            p_contact: contact,
            p_phone: phone,
            p_address: address,
            p_remark: remark
          });
          if (!r || !r.ok) throw new Error((r && r.msg) || '下单失败');
          Cart.clear();
          Session.setCustomer({ ...c, contact, address });
          close();
          toast('下单成功，等待商家接单', 'ok');
          await loadProducts();
          switchTab('orders');
          refreshOrders();
        } catch (err) {
          toast(err.message, 'err');
          btn.disabled = false; btn.textContent = '提交订单';
        }
      };
    }
  });
}

async function loadProducts() {
  state.products = (await yxlsRpc('yxls_products', { p_category: null })) || [];
  window.__yxlsProducts = state.products;
  renderCategories();
  renderProducts();
}

/* ---------------------------------------------------------------- 订单 */
async function refreshOrders() {
  if (!Session.isLogin) { state.orders = []; renderOrders(); return; }
  try {
    const r = await yxlsRpc('yxls_orders_mine', { p_token: Session.token });
    if (r && r.ok) state.orders = r.data || [];
    renderOrders();
  } catch (err) {
    document.getElementById('orderList').innerHTML =
      `<div class="empty"><strong>加载失败</strong>${escapeHtml(err.message)}</div>`;
  }
}

function renderOrders() {
  const box = document.getElementById('orderList');
  document.getElementById('meOrderCount').textContent = state.orders.length + ' 单';

  if (!Session.isLogin) {
    document.getElementById('orderHint').textContent = '';
    box.innerHTML = `<div class="empty"><strong>还没有登录</strong>登录后可查看订单
      <div style="margin-top:14px"><button class="btn btn-primary" onclick="openAuth('login')">去登录</button></div></div>`;
    return;
  }
  if (!state.orders.length) {
    document.getElementById('orderHint').textContent = '';
    box.innerHTML = `<div class="empty"><strong>还没有订单</strong>去选购几箱饮料吧
      <div style="margin-top:14px"><button class="btn btn-primary" onclick="switchTab('shop')">去选购</button></div></div>`;
    return;
  }

  document.getElementById('orderHint').textContent = `共 ${state.orders.length} 笔`;
  box.innerHTML = state.orders.map(o => {
    const st = statusInfo(o.status);
    return `
    <div class="card order-card">
      <div class="order-top">
        <span class="badge ${st.cls}">${st.text}</span>
        <span class="order-no">${escapeHtml(o.order_no)}</span>
        <span class="muted small" style="margin-left:auto">${fmtTime(o.created_at)}</span>
      </div>
      <div class="order-items">
        ${(o.items || []).map(it => `
          <div class="order-item-row">
            <span>${escapeHtml(it.product_name)} <span class="muted">· ${unitText(it.unit)} × ${it.qty}</span></span>
            <span>${yuan(it.subtotal)}</span>
          </div>`).join('')}
      </div>
      ${o.address ? `<p class="hint" style="margin-top:8px">收货：${escapeHtml(o.contact)} ${escapeHtml(o.phone)} · ${escapeHtml(o.address)}</p>` : ''}
      ${o.remark ? `<p class="hint">备注：${escapeHtml(o.remark)}</p>` : ''}
      <div class="order-foot">
        <span class="order-total">共 ${o.total_qty} 件　<b>${yuan(o.total_amount)}</b></span>
        ${o.status === 'pending' ? `<button class="btn btn-sm" data-cancel-order="${o.id}">取消订单</button>` : ''}
        <button class="btn btn-sm btn-ghost" data-reorder="${o.id}">再来一单</button>
      </div>
    </div>`;
  }).join('');
}

document.addEventListener('click', async e => {
  const cancel = e.target.closest('[data-cancel-order]');
  if (cancel) {
    if (!confirm('确定取消这笔订单吗？')) return;
    try {
      const r = await yxlsRpc('yxls_order_cancel', { p_token: Session.token, p_order_id: Number(cancel.dataset.cancelOrder) });
      if (!r.ok) throw new Error(r.msg);
      toast(r.msg || '已取消', 'ok');
      await refreshOrders();
      await loadProducts();
    } catch (err) { toast(err.message, 'err'); }
    return;
  }

  const reorder = e.target.closest('[data-reorder]');
  if (reorder) {
    const o = state.orders.find(x => String(x.id) === reorder.dataset.reorder);
    if (!o) return;
    let added = 0;
    (o.items || []).forEach(it => {
      const p = state.products.find(x => x.name === it.product_name);
      if (p) { Cart.add(p, it.unit, it.qty); added++; }
    });
    if (!added) { toast('商品已下架，无法再来一单', 'err'); return; }
    toast('已加入购物车', 'ok');
    openCart();
  }
});

/* ---------------------------------------------------------------- 我的 */
function renderMe() {
  const c = Session.customer;
  const name = document.getElementById('meName');
  const phone = document.getElementById('mePhone');
  const av = document.getElementById('meAvatar');

  if (!c) {
    name.textContent = '未登录';
    phone.textContent = '登录后可下单与查看订单';
    av.textContent = '游';
    document.getElementById('meAddress').textContent = '未填写';
    document.getElementById('meInvite').textContent = '-';
    document.getElementById('btnLogout').textContent = '登录 / 注册';
  } else {
    name.textContent = c.nickname || ('顾客' + String(c.phone).slice(-4));
    phone.textContent = c.phone || '';
    av.textContent = (c.nickname || '顾').slice(0, 1);
    document.getElementById('meAddress').textContent = c.address || '未填写';
    document.getElementById('meInvite').textContent = c.invite_code || '-';
    document.getElementById('btnLogout').textContent = '退出登录';
  }
}

document.addEventListener('click', e => {
  const row = e.target.closest('[data-me]');
  const tab = e.target.closest('[data-tab]');
  const openCartBtn = e.target.closest('#btnOpenCart');

  if (openCartBtn) { openCart(); return; }
  if (tab) { switchTab(tab.dataset.tab); return; }
  if (!row) return;

  const act = row.dataset.me;
  if (!Session.isLogin && ['profile', 'invite', 'password', 'orders'].includes(act)) {
    openAuth('login'); return;
  }
  if (act === 'orders') { switchTab('orders'); refreshOrders(); }
  if (act === 'invite') {
    openModal({
      title: '我的邀请码',
      body: `<p class="hint">你是通过下面这个邀请码注册的，把它分享给朋友，朋友注册时填入即可。</p>
             <div class="card pad center" style="margin-top:12px;font-size:22px;font-weight:700;letter-spacing:.12em">
               ${escapeHtml(Session.customer.invite_code || '-')}</div>`,
      foot: `<button class="btn btn-block" data-close>知道了</button>`
    });
  }
  if (act === 'contact') {
    const s = state.settings;
    openModal({
      title: '联系商家',
      body: `<div class="card pad" style="box-shadow:none;background:var(--surface-2)">
        <div class="order-item-row"><span class="muted">客服电话</span><strong>${escapeHtml(s.contact_phone || '-')}</strong></div>
        <div class="order-item-row" style="margin-top:8px"><span class="muted">客服微信</span><strong>${escapeHtml(s.wechat || '-')}</strong></div>
        <div class="order-item-row" style="margin-top:8px"><span class="muted">门店地址</span><strong style="text-align:right">${escapeHtml(s.address || '-')}</strong></div>
        <div class="order-item-row" style="margin-top:8px"><span class="muted">营业时间</span><strong>${escapeHtml(s.open_hours || '-')}</strong></div>
      </div>`,
      foot: `<button class="btn btn-block" data-close>关闭</button>`
    });
  }
  if (act === 'profile') {
    const c = Session.customer;
    openModal({
      title: '收货信息',
      body: `<div class="field"><label>称呼</label><input class="input" id="pfNick" value="${escapeHtml(c.nickname || '')}" placeholder="建议直接写微信用户名"></div>
             <div class="field"><label>联系人</label><input class="input" id="pfContact" value="${escapeHtml(c.contact || '')}" placeholder="收货人姓名"></div>
             <div class="field"><label>常用地址</label><textarea class="textarea" id="pfAddress" placeholder="默认收货地址">${escapeHtml(c.address || '')}</textarea></div>`,
      foot: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="pfSave">保存</button>`,
      onMount(el, close) {
        el.querySelector('#pfSave').onclick = async () => {
          try {
            const r = await yxlsRpc('yxls_profile_update', {
              p_token: Session.token,
              p_nickname: el.querySelector('#pfNick').value.trim(),
              p_contact: el.querySelector('#pfContact').value.trim(),
              p_address: el.querySelector('#pfAddress').value.trim()
            });
            if (!r.ok) throw new Error(r.msg);
            Session.setCustomer(r.customer);
            renderMe(); close(); toast('已保存', 'ok');
          } catch (err) { toast(err.message, 'err'); }
        };
      }
    });
  }
  if (act === 'password') {
    openModal({
      title: '修改密码',
      body: `<div class="field"><label>原密码</label><input class="input" id="pwOld" type="password"></div>
             <div class="field"><label>新密码</label><input class="input" id="pwNew" type="password" placeholder="至少 6 位"></div>`,
      foot: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="pwSave">确认修改</button>`,
      onMount(el, close) {
        el.querySelector('#pwSave').onclick = async () => {
          try {
            const r = await yxlsRpc('yxls_password_change', {
              p_token: Session.token,
              p_old: el.querySelector('#pwOld').value,
              p_new: el.querySelector('#pwNew').value
            });
            if (!r.ok) throw new Error(r.msg);
            close(); toast('密码已修改', 'ok');
          } catch (err) { toast(err.message, 'err'); }
        };
      }
    });
  }
});

document.getElementById('btnLogout').onclick = () => {
  if (!Session.isLogin) { openAuth('login'); return; }
  openAuth('account');
};

/* ---------------------------------------------------------------- 视图切换 */
function switchTab(name) {
  state.tab = name;
  document.getElementById('viewShop').classList.toggle('hidden', name !== 'shop');
  document.getElementById('viewSeckill').classList.toggle('hidden', name !== 'seckill');
  document.getElementById('viewOrders').classList.toggle('hidden', name !== 'orders');
  document.getElementById('viewMe').classList.toggle('hidden', name !== 'me');
  document.querySelectorAll('#tabBar button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'seckill') { renderSeckill(); loadSeckills(); }
  if (name === 'orders') refreshOrders();
  if (name === 'me') renderMe();
  window.scrollTo(0, 0);
}

function bindShell() {
  document.getElementById('btnCheckout').onclick = () => {
    if (!Session.isLogin) { openAuth('login', () => { if (Session.isLogin) openCheckout(); }); return; }
    openCheckout();
  };
  const search = document.getElementById('searchInput');
  search.classList.remove('hidden');
  search.addEventListener('input', () => { state.keyword = search.value; renderProducts(); });
}

boot();
