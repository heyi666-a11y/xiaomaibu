/* ============================================================================
   印相便利店 · YXLS Store — 数据接口层
   --------------------------------------------------------------------------
   所有读写都通过 Supabase 的 yxls_* RPC 函数完成：
   前端只持有 publishable(公开) 密钥，数据表的直读直写权限已在数据库侧回收。
   ========================================================================== */

const YXLS = {
  url: 'https://yzhnrtinfztdumfzuxvk.supabase.co',
  key: 'sb_publishable_yebBr2U45Y5yWMUzNcaBkw_NRaAwZEM',
  signature: 'YXLS-v1',
  brand: '印相便利店'
};

/* ----------------------------------------------------------------- RPC */
async function yxlsRpc(fn, args = {}) {
  const res = await fetch(`${YXLS.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'apikey': YXLS.key,
      'Authorization': 'Bearer ' + YXLS.key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = raw; }
  if (!res.ok) {
    const msg = (data && (data.message || data.hint || data.msg)) || `请求失败(${res.status})`;
    throw new Error(String(msg).replace(/^ERROR:\s*/i, ''));
  }
  return data;
}

/* ------------------------------------------------------------- 会话管理 */
const Session = {
  get token() { return localStorage.getItem('yxls_token') || ''; },
  get customer() {
    try { return JSON.parse(localStorage.getItem('yxls_customer') || 'null'); }
    catch (e) { return null; }
  },
  save(token, customer) {
    if (token) localStorage.setItem('yxls_token', token);
    if (customer) localStorage.setItem('yxls_customer', JSON.stringify(customer));
  },
  setCustomer(customer) {
    if (customer) localStorage.setItem('yxls_customer', JSON.stringify(customer));
  },
  clear() {
    localStorage.removeItem('yxls_token');
    localStorage.removeItem('yxls_customer');
  },
  get isLogin() { return !!this.token; }
};

/* --------------------------------------------------------------- 购物车 */
const Cart = {
  key: 'yxls_cart',
  read() {
    try { return JSON.parse(localStorage.getItem(this.key) || '[]'); }
    catch (e) { return []; }
  },
  write(items) {
    localStorage.setItem(this.key, JSON.stringify(items));
    window.dispatchEvent(new CustomEvent('yxls:cart'));
  },
  add(product, unit, qty = 1) {
    const items = this.read();
    const hit = items.find(i => i.product_id === product.id && i.unit === unit);
    if (hit) hit.qty += qty;
    else items.push({
      product_id: product.id,
      barcode: product.barcode || '',
      name: product.name,
      spec: product.spec,
      unit,
      qty,
      price: Number(unit === 'box' ? product.box_price : product.bottle_price),
      bottle_count: product.bottle_count
    });
    this.write(items);
  },
  setQty(index, qty) {
    const items = this.read();
    if (!items[index]) return;
    if (qty <= 0) items.splice(index, 1);
    else items[index].qty = qty;
    this.write(items);
  },
  setUnit(index, unit) {
    const items = this.read();
    const it = items[index];
    if (!it) return;
    const p = window.__yxlsProducts || [];
    const prod = p.find(x => x.id === it.product_id);
    if (!prod) return;
    it.unit = unit;
    it.price = Number(unit === 'box' ? prod.box_price : prod.bottle_price);
    this.write(items);
  },
  remove(index) {
    const items = this.read();
    items.splice(index, 1);
    this.write(items);
  },
  clear() { this.write([]); },
  get count() { return this.read().reduce((s, i) => s + i.qty, 0); },
  get amount() { return this.read().reduce((s, i) => s + i.qty * i.price, 0); }
};

/* --------------------------------------------------------------- 小工具 */
const yuan = n => '¥' + Number(n || 0).toFixed(2);

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fmtTime(iso, withTime = true) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${day} ${p(d.getHours())}:${p(d.getMinutes())}` : day;
}

const ORDER_STATUS = {
  pending:    { text: '待商家接单', cls: 'badge-pending' },
  confirmed:  { text: '商家已接单', cls: 'badge-confirmed' },
  delivering: { text: '配送中',     cls: 'badge-delivering' },
  completed:  { text: '已完成',     cls: 'badge-completed' },
  cancelled:  { text: '已取消',     cls: 'badge-cancelled' }
};
const statusInfo = s => ORDER_STATUS[s] || { text: s || '-', cls: '' };

function unitText(u) { return u === 'box' ? '整箱' : '单瓶'; }

/* --------------------------------------------------------------- 提示条 */
function toast(msg, type = '') {
  const host = document.getElementById('toastHost');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

/* --------------------------------------------------------------- 弹层组件 */
function openModal({ title, body, foot, large = false, onMount }) {
  const host = document.getElementById('modalHost');
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal ${large ? 'modal-lg' : ''}">
      <div class="modal-head"><h3>${escapeHtml(title)}</h3><button class="x-btn" data-close>✕</button></div>
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
    </div>`;
  host.appendChild(mask);
  document.body.classList.add('no-scroll');
  const close = () => {
    mask.remove();
    if (!host.children.length) document.body.classList.remove('no-scroll');
  };
  mask.addEventListener('click', e => {
    if (e.target === mask || e.target.closest('[data-close]')) close();
  });
  if (onMount) onMount(mask, close);
  return { el: mask, close };
}

function openDrawer({ title, body, foot, onMount }) {
  const host = document.getElementById('drawerHost');
  const mask = document.createElement('div');
  mask.className = 'drawer-mask';
  const drawer = document.createElement('div');
  drawer.className = 'drawer';
  drawer.innerHTML = `
    <div class="drawer-head"><h3>${escapeHtml(title)}</h3><button class="x-btn" data-close>✕</button></div>
    <div class="drawer-body">${body}</div>
    ${foot ? `<div class="drawer-foot">${foot}</div>` : ''}`;
  host.appendChild(mask);
  host.appendChild(drawer);
  document.body.classList.add('no-scroll');
  const close = () => {
    mask.remove(); drawer.remove();
    if (!host.children.length) document.body.classList.remove('no-scroll');
  };
  mask.addEventListener('click', close);
  drawer.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  if (onMount) onMount(drawer, close);
  return { el: drawer, close };
}

/* ------------------------------------------------- 商品配图（自动生成） */
const YXLS_IMAGE_PROMPTS = {
  '6921168598427': 'commercial product photo of a 900ml plastic bottle of Chinese jasmine green tea, clear bottle with fresh green label, studio lighting',
  '6921168598649': 'commercial product photo of a 900ml plastic bottle of Chinese dark pu-erh tea drink, clear bottle with deep amber label, studio lighting',
  '6921168593569': 'commercial product photo of a 500ml plastic bottle of peach oolong tea drink, pink and white label, studio lighting',
  '6921168593552': 'commercial product photo of a 500ml plastic bottle of grapefruit jasmine tea drink, light yellow label, studio lighting',
  '6921168596348': 'commercial product photo of a 500ml plastic bottle of Chinese pu-erh tea drink, minimal label, studio lighting',
  '6921168558032': 'commercial product photo of a 500ml plastic bottle of Chinese oolong tea drink, minimal label, studio lighting',
  '6921168558049': 'commercial product photo of a 500ml plastic bottle of Chinese jasmine tea drink, minimal label, studio lighting',
  '6921168563074': 'commercial product photo of a 600ml plastic bottle of iced lemon black tea, yellow label, studio lighting',
  '6921168563883': 'commercial product photo of a 550ml sports drink bottle, grapefruit flavour, blue and white label, studio lighting',
  '6921168563869': 'commercial product photo of a 550ml sports drink bottle, lemon flavour, blue and white label, studio lighting',
  '6921168504022': 'commercial product photo of a 550ml isotonic sports drink bottle, green label, dynamic look, studio lighting',
  '6921168504015': 'commercial product photo of a 550ml isotonic sports drink bottle, blue label, dynamic look, studio lighting',
  '6921168500956': 'commercial product photo of a 445ml vitamin C lemon juice drink bottle, yellow label, studio lighting',
  '6921168500970': 'commercial product photo of a 445ml vitamin C grapefruit juice drink bottle, pink label, studio lighting',
  '6921168550142': 'commercial product photo of a 500ml vitamin water bottle, orange flavour, clean label, studio lighting',
  '6921168550128': 'commercial product photo of a 500ml vitamin water bottle, lemon flavour, clean label, studio lighting',
  '6921168564330': 'commercial product photo of a 950ml large sports drink bottle, lemon flavour, blue label, studio lighting',
  '6921168564354': 'commercial product photo of a 950ml large sports drink bottle, grapefruit flavour, blue label, studio lighting',
  '6921168509256': 'commercial product photo of a 550ml bottle of pure natural mineral water, transparent bottle with red cap, studio lighting',
  '6921168520015': 'commercial product photo of a 1.5 litre bottle of natural mineral water, transparent bottle, red cap, studio lighting',
  '6921168593521': 'commercial product photo of a 2.1 litre large bottle of natural mineral water, transparent bottle, studio lighting'
};

function productImage(p) {
  if (p && p.image_url) return p.image_url;
  const prompt = (p && YXLS_IMAGE_PROMPTS[p.barcode])
    || `commercial product photo of bottled beverage ${p ? p.name : ''}, clean white background, studio lighting, centered`;
  return 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image'
    + '?prompt=' + encodeURIComponent(prompt)
    + '&image_size=square';
}

/* 图片加载失败时退回纯色占位，避免出现破图 */
function imgFallback(el) {
  el.onerror = null;
  el.removeAttribute('src');
  el.style.background = 'linear-gradient(135deg,#eef1ef,#e3e8e5)';
}

window.YXLS = YXLS;
window.yxlsRpc = yxlsRpc;
window.Session = Session;
window.Cart = Cart;
window.yuan = yuan;
window.escapeHtml = escapeHtml;
window.fmtTime = fmtTime;
window.statusInfo = statusInfo;
window.unitText = unitText;
window.toast = toast;
window.productImage = productImage;
window.imgFallback = imgFallback;
window.openModal = openModal;
window.openDrawer = openDrawer;
