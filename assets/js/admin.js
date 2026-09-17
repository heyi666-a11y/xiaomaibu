/* ============================================================================
   印相便利店 · 商家后台逻辑
   ========================================================================== */

const Admin = {
  token: () => localStorage.getItem('yxls_admin_token') || '',
  user: () => { try { return JSON.parse(localStorage.getItem('yxls_admin_user') || 'null'); } catch (e) { return null; } },
  save(t, u) { localStorage.setItem('yxls_admin_token', t); localStorage.setItem('yxls_admin_user', JSON.stringify(u)); },
  clear() { localStorage.removeItem('yxls_admin_token'); localStorage.removeItem('yxls_admin_user'); }
};

const A = {
  view: 'overview',
  stats: null,
  orders: [],
  products: [],
  invites: [],
  customers: [],
  settings: {},
  orderFilter: '',
  orderKeyword: '',
  custKeyword: '',
  prodKeyword: ''
};

/* 统一调用：自动带上管理员 token，并处理登录失效 */
async function adminRpc(fn, args = {}) {
  const r = await yxlsRpc(fn, { p_token: Admin.token(), ...args });
  if (r && r.ok === false && /无权限|登录已过期/.test(r.msg || '')) {
    Admin.clear();
    showLogin();
    throw new Error('登录已过期，请重新登录');
  }
  return r;
}

/* ------------------------------------------------------------------ 登录 */
function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('adminShell').classList.add('hidden');
}
function showShell() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('adminShell').classList.remove('hidden');
  const u = Admin.user();
  document.getElementById('sideUser').textContent = u ? `${u.nickname || '管理员'} · ${u.phone}` : '';
}

async function doLogin() {
  const phone = document.getElementById('lgPhone').value.trim();
  const pwd = document.getElementById('lgPwd').value;
  const btn = document.getElementById('lgBtn');
  if (!/^1\d{10}$/.test(phone)) { toast('请输入正确的手机号', 'err'); return; }
  if (!pwd) { toast('请输入密码', 'err'); return; }
  btn.disabled = true; btn.textContent = '登录中…';
  try {
    const r = await yxlsRpc('yxls_admin_login', { p_phone: phone, p_password: pwd });
    if (!r.ok) throw new Error(r.msg || '登录失败');
    Admin.save(r.token, r.customer);
    document.getElementById('lgPwd').value = '';
    showShell();
    toast('欢迎回来，' + (r.customer.nickname || '管理员'), 'ok');
    go('overview');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false; btn.textContent = '登录后台';
  }
}

/* --------------------------------------------------------------- 路由 */
const VIEW_TITLE = {
  overview: '经营概览', orders: '订单管理', products: '商品管理',
  invites: '邀请码', customers: '客户管理', settings: '店铺设置'
};

function go(view) {
  A.view = view;
  document.getElementById('viewTitle').textContent = VIEW_TITLE[view] || '商家后台';
  document.querySelectorAll('#adminNav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('btnPrimary').classList.toggle('hidden', !['products', 'invites'].includes(view));
  document.getElementById('btnPrimary').textContent = view === 'invites' ? '新增邀请码' : '新增商品';
  render();
  window.scrollTo(0, 0);
}

async function render() {
  const body = document.getElementById('adminBody');
  body.innerHTML = `<div class="empty">加载中…</div>`;
  try {
    if (A.view === 'overview') await viewOverview(body);
    else if (A.view === 'orders') await viewOrders(body);
    else if (A.view === 'products') await viewProducts(body);
    else if (A.view === 'invites') await viewInvites(body);
    else if (A.view === 'customers') await viewCustomers(body);
    else if (A.view === 'settings') await viewSettings(body);
  } catch (err) {
    body.innerHTML = `<div class="empty"><strong>加载失败</strong>${escapeHtml(err.message)}</div>`;
  }
}

/* --------------------------------------------------------------- 概览 */
async function viewOverview(body) {
  const r = await adminRpc('yxls_admin_stats');
  A.stats = r.data || {};
  const s = A.stats;
  const n = v => Number(v || 0);

  body.innerHTML = `
    <div class="stat-grid">
      <div class="card stat"><div class="stat-label">今日订单</div><div class="stat-value">${n(s.today_orders)}</div>
        <div class="stat-sub">待接单 ${n(s.pending_orders)} 笔</div></div>
      <div class="card stat"><div class="stat-label">今日营业额</div><div class="stat-value">${yuan(s.today_amount)}</div>
        <div class="stat-sub">毛利约 ${yuan(s.today_profit)}</div></div>
      <div class="card stat"><div class="stat-label">累计营业额</div><div class="stat-value">${yuan(s.total_amount)}</div>
        <div class="stat-sub">共 ${n(s.total_orders)} 笔订单</div></div>
      <div class="card stat"><div class="stat-label">累计毛利</div><div class="stat-value">${yuan(s.total_profit)}</div>
        <div class="stat-sub">按商品成本价估算</div></div>
      <div class="card stat"><div class="stat-label">客户数</div><div class="stat-value">${n(s.customers)}</div>
        <div class="stat-sub">邀请码 ${n(s.invites)} 个</div></div>
      <div class="card stat"><div class="stat-label">在售商品</div><div class="stat-value">${n(s.products)}</div>
        <div class="stat-sub">库存告警 ${n(s.low_stock)} 款</div></div>
    </div>

    <div class="section">
      <div class="section-head"><h2>热销商品</h2><span class="muted">按销量排序</span></div>
      <div class="card pad">
        ${(s.top_products || []).length ? (s.top_products || []).map((t, i) => `
          <div class="order-item-row" style="padding:7px 0">
            <span><span class="muted mono">${String(i + 1).padStart(2, '0')}</span>　${escapeHtml(t.product_name)}</span>
            <span><span class="muted">×${t.qty}</span>　<strong>${yuan(t.amount)}</strong></span>
          </div>`).join('') : '<div class="muted small">暂无销售数据</div>'}
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>最近订单</h2></div>
      <div class="card pad">
        ${(s.recent_orders || []).length ? (s.recent_orders || []).map(o => {
          const st = statusInfo(o.status);
          return `<div class="order-item-row" style="padding:8px 0;align-items:center">
            <span><span class="badge ${st.cls}">${st.text}</span>　${escapeHtml(o.contact || '-')}</span>
            <span><span class="muted small">${fmtTime(o.created_at)}</span>　<strong>${yuan(o.total_amount)}</strong></span>
          </div>`;
        }).join('') : '<div class="muted small">暂无订单</div>'}
      </div>
    </div>`;
}

/* --------------------------------------------------------------- 订单 */
async function loadOrders() {
  const r = await adminRpc('yxls_admin_orders', {
    p_status: A.orderFilter || '',
    p_keyword: A.orderKeyword || '',
    p_limit: 200,
    p_offset: 0
  });
  A.orders = r.data || [];
}

async function viewOrders(body) {
  await loadOrders();
  const tabs = [['', '全部'], ['pending', '待接单'], ['confirmed', '已接单'],
                ['delivering', '配送中'], ['completed', '已完成'], ['cancelled', '已取消']];

  body.innerHTML = `
    <div class="toolbar">
      <div class="chips" id="orderTabs">
        ${tabs.map(([v, t]) => `<button class="chip ${A.orderFilter === v ? 'active' : ''}" data-ofilter="${v}">${t}</button>`).join('')}
      </div>
      <div class="grow"></div>
      <input class="input" id="orderKw" placeholder="搜订单号 / 联系人 / 手机" value="${escapeHtml(A.orderKeyword)}">
    </div>
    <div id="orderListBox"></div>`;

  document.getElementById('orderTabs').onclick = e => {
    const b = e.target.closest('[data-ofilter]');
    if (!b) return;
    A.orderFilter = b.dataset.ofilter;
    viewOrders(body);
  };
  const kw = document.getElementById('orderKw');
  let t = null;
  kw.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { A.orderKeyword = kw.value.trim(); loadOrders().then(paintOrders); }, 350);
  });

  paintOrders();
}

function paintOrders() {
  const box = document.getElementById('orderListBox');
  if (!A.orders.length) {
    box.innerHTML = `<div class="empty"><strong>没有符合条件的订单</strong>换个筛选条件试试</div>`;
    return;
  }
  box.innerHTML = A.orders.map(o => {
    const st = statusInfo(o.status);
    const profit = Number(o.total_amount) - Number(o.cost_amount);
    const acts = {
      pending: [['confirmed', '接单'], ['cancelled', '取消']],
      confirmed: [['delivering', '开始配送'], ['cancelled', '取消']],
      delivering: [['completed', '完成订单']],
      completed: [],
      cancelled: []
    }[o.status] || [];

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
            <span>${escapeHtml(it.product_name)} <span class="muted">· ${unitText(it.unit)} × ${it.qty}（${it.bottles} 瓶）</span></span>
            <span>${yuan(it.subtotal)}</span>
          </div>`).join('')}
      </div>
      <p class="hint" style="margin-top:8px">
        ${escapeHtml(o.contact || '')}　${escapeHtml(o.phone || '')}<br>
        ${escapeHtml(o.address || '未填地址')}
        ${o.remark ? `<br>备注：${escapeHtml(o.remark)}` : ''}
        ${o.invite_code ? `<br>邀请码：${escapeHtml(o.invite_code)}` : ''}
      </p>
      <div class="order-foot">
        <span class="muted small">毛利 ${yuan(profit)}</span>
        <span class="order-total">共 ${o.total_qty} 件　<b>${yuan(o.total_amount)}</b></span>
        ${acts.map(([v, t]) => `<button class="btn btn-sm ${v === 'completed' ? 'btn-accent' : ''}" data-ostatus="${v}" data-oid="${o.id}">${t}</button>`).join('')}
      </div>
    </div>`;
  }).join('');
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-ostatus]');
  if (!b) return;
  const label = { confirmed: '接单', delivering: '开始配送', completed: '完成订单', cancelled: '取消订单' }[b.dataset.ostatus] || '更新';
  if (b.dataset.ostatus === 'cancelled' && !confirm('取消后库存会自动回补，确定吗？')) return;
  try {
    const r = await adminRpc('yxls_admin_order_status', {
      p_order_id: Number(b.dataset.oid), p_status: b.dataset.ostatus
    });
    if (!r.ok) throw new Error(r.msg);
    toast(label + '成功', 'ok');
    render();
  } catch (err) { toast(err.message, 'err'); }
});

/* --------------------------------------------------------------- 商品 */
async function viewProducts(body) {
  const r = await adminRpc('yxls_admin_products');
  A.products = r.data || [];
  const kw = A.prodKeyword.toLowerCase();
  const list = A.products.filter(p => !kw || (p.name + p.barcode + p.category).toLowerCase().includes(kw));

  body.innerHTML = `
    <div class="toolbar">
      <input class="input grow" id="prodKw" placeholder="搜商品名称 / 条码 / 分类" value="${escapeHtml(A.prodKeyword)}">
      <span class="muted small">共 ${A.products.length} 款</span>
    </div>
    <div class="card table-wrap">
      <table class="data">
        <thead><tr>
          <th>商品</th><th>分类</th><th>规格</th>
          <th class="num">单瓶价</th><th class="num">整箱价</th><th class="num">成本</th>
          <th class="num">库存(瓶)</th><th>状态</th><th>操作</th>
        </tr></thead>
        <tbody>
          ${list.map(p => `
            <tr>
              <td>
                <div style="display:flex;align-items:center;gap:10px">
                  <img class="thumb-sm" src="${productImage(p)}" onerror="imgFallback(this)" alt="">
                  <div style="min-width:0">
                    <div style="font-weight:550">${escapeHtml(p.name)}</div>
                    <div class="muted small mono">${escapeHtml(p.barcode || '-')}</div>
                  </div>
                </div>
              </td>
              <td>${escapeHtml(p.category || '-')}</td>
              <td class="nowrap">${escapeHtml(p.spec || '')} / ${p.bottle_count}瓶</td>
              <td class="num">${yuan(p.bottle_price)}</td>
              <td class="num">${yuan(p.box_price)}</td>
              <td class="num muted">${yuan(p.cost_price)}</td>
              <td class="num">${p.stock_bottles}</td>
              <td>${p.is_active ? '<span class="badge badge-completed">在售</span>' : '<span class="badge">已下架</span>'}</td>
              <td class="nowrap">
                <button class="btn btn-sm" data-pedit="${p.id}">编辑</button>
                <button class="btn btn-sm btn-ghost" data-ptoggle="${p.id}">${p.is_active ? '下架' : '上架'}</button>
                <button class="btn btn-sm btn-ghost" data-pdel="${p.id}" style="color:var(--danger)">删除</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="9" class="muted center" style="padding:40px">没有匹配的商品</td></tr>'}
        </tbody>
      </table>
    </div>`;

  const k = document.getElementById('prodKw');
  let t = null;
  k.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { A.prodKeyword = k.value.trim(); viewProducts(body); }, 300);
  });
}

function productForm(p) {
  p = p || {};
  return `
    <div class="field-row">
      <div class="field"><label>商品名称 *</label><input class="input" id="fName" value="${escapeHtml(p.name || '')}"></div>
      <div class="field" style="max-width:130px"><label>分类</label><input class="input" id="fCategory" value="${escapeHtml(p.category || '')}" placeholder="茶饮/饮用水"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>条形码</label><input class="input" id="fBarcode" value="${escapeHtml(p.barcode || '')}"></div>
      <div class="field"><label>规格</label><input class="input" id="fSpec" value="${escapeHtml(p.spec || '')}" placeholder="如 1*15"></div>
      <div class="field" style="max-width:110px"><label>每箱瓶数</label><input class="input" id="fCount" type="number" min="1" value="${p.bottle_count || 1}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>单瓶售价</label><input class="input" id="fBottle" type="number" step="0.01" value="${p.bottle_price ?? ''}"></div>
      <div class="field"><label>整箱售价</label><input class="input" id="fBox" type="number" step="0.01" value="${p.box_price ?? ''}"></div>
      <div class="field"><label>成本价/瓶</label><input class="input" id="fCost" type="number" step="0.01" value="${p.cost_price ?? ''}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>库存（瓶）</label><input class="input" id="fStock" type="number" value="${p.stock_bottles ?? 0}"></div>
      <div class="field"><label>排序（越小越前）</label><input class="input" id="fSort" type="number" value="${p.sort_order ?? 0}"></div>
    </div>
    <div class="field"><label>商品图片 URL（留空则自动生成示意图）</label><input class="input" id="fImage" value="${escapeHtml(p.image_url || '')}"></div>
    <div class="field"><label>上架状态</label>
      <select class="select" id="fActive">
        <option value="true" ${p.is_active !== false ? 'selected' : ''}>在售</option>
        <option value="false" ${p.is_active === false ? 'selected' : ''}>下架</option>
      </select>
    </div>
    <p class="hint">提示：修改「每箱瓶数 / 单瓶售价」后，可点下方按钮自动换算整箱价。</p>`;
}

function bindProductForm(el, close, editing) {
  const $ = id => el.querySelector('#' + id);
  const recalc = () => {
    const c = Number($('fCount').value || 0);
    const b = Number($('fBottle').value || 0);
    if (c > 0 && b > 0) $('fBox').value = (c * b).toFixed(2);
  };
  $('fCount').addEventListener('change', recalc);
  $('fBottle').addEventListener('change', recalc);

  el.querySelector('#fSave').onclick = async () => {
    const data = {
      id: editing ? editing.id : null,
      name: $('fName').value.trim(),
      category: $('fCategory').value.trim(),
      barcode: $('fBarcode').value.trim(),
      spec: $('fSpec').value.trim(),
      bottle_count: Number($('fCount').value || 1),
      bottle_price: Number($('fBottle').value || 0),
      box_price: Number($('fBox').value || 0),
      cost_price: Number($('fCost').value || 0),
      stock_bottles: Number($('fStock').value || 0),
      sort_order: Number($('fSort').value || 0),
      image_url: $('fImage').value.trim(),
      is_active: $('fActive').value === 'true'
    };
    if (!data.name) { toast('请填写商品名称', 'err'); return; }
    try {
      const r = await adminRpc('yxls_admin_product_save', { p_data: data });
      if (!r.ok) throw new Error(r.msg);
      close();
      toast('已保存', 'ok');
      render();
    } catch (err) { toast(err.message, 'err'); }
  };
}

document.addEventListener('click', async e => {
  const edit = e.target.closest('[data-pedit]');
  const toggle = e.target.closest('[data-ptoggle]');
  const del = e.target.closest('[data-pdel]');
  const add = e.target.closest('#btnPrimary');

  if (edit) {
    const p = A.products.find(x => String(x.id) === edit.dataset.pedit);
    openModal({
      title: '编辑商品', large: true, body: productForm(p),
      foot: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="fSave">保存</button>`,
      onMount: (el, close) => bindProductForm(el, close, p)
    });
  } else if (toggle) {
    const p = A.products.find(x => String(x.id) === toggle.dataset.ptoggle);
    try {
      const r = await adminRpc('yxls_admin_product_save', { p_data: { id: p.id, name: p.name, is_active: !p.is_active } });
      if (!r.ok) throw new Error(r.msg);
      toast(p.is_active ? '已下架' : '已上架', 'ok');
      render();
    } catch (err) { toast(err.message, 'err'); }
  } else if (del) {
    if (!confirm('确定删除这个商品吗？')) return;
    try {
      const r = await adminRpc('yxls_admin_product_delete', { p_id: Number(del.dataset.pdel) });
      if (!r.ok) throw new Error(r.msg);
      toast(r.msg || '已删除', 'ok');
      render();
    } catch (err) { toast(err.message, 'err'); }
  } else if (add && A.view === 'products') {
    openModal({
      title: '新增商品', large: true, body: productForm(null),
      foot: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="fSave">保存</button>`,
      onMount: (el, close) => bindProductForm(el, close, null)
    });
  }
});

/* --------------------------------------------------------------- 邀请码 */
async function viewInvites(body) {
  const r = await adminRpc('yxls_admin_invites');
  A.invites = r.data || [];

  body.innerHTML = `
    <div class="toolbar">
      <span class="muted small">邀请码用于买家注册，可查看每个码带来的客户数与销售额</span>
    </div>
    <div class="card table-wrap">
      <table class="data">
        <thead><tr>
          <th>邀请码</th><th>归属</th><th>备注</th>
          <th class="num">已用/上限</th><th class="num">客户数</th><th class="num">销售额</th>
          <th>状态</th><th>操作</th>
        </tr></thead>
        <tbody>
          ${A.invites.map(v => `
            <tr>
              <td class="mono" style="font-weight:600;letter-spacing:.06em">${escapeHtml(v.code)}</td>
              <td>${escapeHtml(v.owner_name || '-')}</td>
              <td class="muted">${escapeHtml(v.note || '-')}</td>
              <td class="num">${v.used_count} / ${v.max_uses == null ? '不限' : v.max_uses}</td>
              <td class="num">${v.customer_count}</td>
              <td class="num">${yuan(v.sales_amount)}</td>
              <td>${v.is_active ? '<span class="badge badge-completed">启用</span>' : '<span class="badge">停用</span>'}</td>
              <td class="nowrap">
                <button class="btn btn-sm" data-iedit="${escapeHtml(v.code)}">编辑</button>
                <button class="btn btn-sm btn-ghost" data-idel="${escapeHtml(v.code)}" style="color:var(--danger)">删除</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="8" class="muted center" style="padding:40px">还没有邀请码</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

function inviteForm(v) {
  v = v || {};
  return `
    <div class="field"><label>邀请码 *（4-20 位字母或数字，会自动转大写）</label>
      <input class="input" id="iCode" value="${escapeHtml(v.code || '')}" style="text-transform:uppercase"></div>
    <div class="field-row">
      <div class="field"><label>归属人 / 业务员</label><input class="input" id="iOwner" value="${escapeHtml(v.owner_name || '')}"></div>
      <div class="field"><label>使用上限（留空=不限）</label><input class="input" id="iMax" type="number" min="1" value="${v.max_uses == null ? '' : v.max_uses}"></div>
    </div>
    <div class="field"><label>备注</label><input class="input" id="iNote" value="${escapeHtml(v.note || '')}"></div>
    <div class="field"><label>状态</label>
      <select class="select" id="iActive">
        <option value="true" ${v.is_active !== false ? 'selected' : ''}>启用</option>
        <option value="false" ${v.is_active === false ? 'selected' : ''}>停用</option>
      </select>
    </div>`;
}

document.addEventListener('click', async e => {
  const edit = e.target.closest('[data-iedit]');
  const del = e.target.closest('[data-idel]');
  const add = e.target.closest('#btnPrimary');

  const save = async (el, close, oldCode) => {
    const data = {
      old_code: oldCode || '',
      code: el.querySelector('#iCode').value.trim().toUpperCase(),
      owner_name: el.querySelector('#iOwner').value.trim(),
      note: el.querySelector('#iNote').value.trim(),
      max_uses: el.querySelector('#iMax').value,
      is_active: el.querySelector('#iActive').value === 'true'
    };
    if (!data.code) { toast('请填写邀请码', 'err'); return; }
    try {
      const r = await adminRpc('yxls_admin_invite_save', { p_data: data });
      if (!r.ok) throw new Error(r.msg);
      close(); toast('已保存', 'ok'); render();
    } catch (err) { toast(err.message, 'err'); }
  };

  if (edit) {
    const v = A.invites.find(x => x.code === edit.dataset.iedit);
    openModal({
      title: '编辑邀请码', body: inviteForm(v),
      foot: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="iSave">保存</button>`,
      onMount: (el, close) => { el.querySelector('#iSave').onclick = () => save(el, close, v.code); }
    });
  } else if (del) {
    if (!confirm('确定删除该邀请码吗？已注册的客户不受影响。')) return;
    try {
      const r = await adminRpc('yxls_admin_invite_delete', { p_code: del.dataset.idel });
      if (!r.ok) throw new Error(r.msg);
      toast('已删除', 'ok'); render();
    } catch (err) { toast(err.message, 'err'); }
  } else if (add && A.view === 'invites') {
    openModal({
      title: '新增邀请码', body: inviteForm(null),
      foot: `<button class="btn" data-close>取消</button><button class="btn btn-primary" id="iSave">保存</button>`,
      onMount: (el, close) => { el.querySelector('#iSave').onclick = () => save(el, close, ''); }
    });
  }
});

/* --------------------------------------------------------------- 客户 */
async function viewCustomers(body) {
  const r = await adminRpc('yxls_admin_customers', { p_keyword: A.custKeyword || '' });
  A.customers = r.data || [];

  body.innerHTML = `
    <div class="toolbar">
      <input class="input grow" id="custKw" placeholder="搜手机号 / 昵称" value="${escapeHtml(A.custKeyword)}">
      <span class="muted small">共 ${A.customers.length} 位</span>
    </div>
    <div class="card table-wrap">
      <table class="data">
        <thead><tr>
          <th>客户</th><th>手机号</th><th>邀请码</th><th>推荐人</th>
          <th class="num">订单数</th><th class="num">累计消费</th><th>最近登录</th><th>状态</th><th>操作</th>
        </tr></thead>
        <tbody>
          ${A.customers.map(c => `
            <tr>
              <td>${escapeHtml(c.nickname || '-')}${c.is_admin ? ' <span class="badge">管理员</span>' : ''}</td>
              <td class="mono">${escapeHtml(c.phone)}</td>
              <td class="mono">${escapeHtml(c.invite_code || '-')}</td>
              <td class="muted small">${escapeHtml(c.referrer || '-')}</td>
              <td class="num">${c.order_count}</td>
              <td class="num">${yuan(c.total_spent)}</td>
              <td class="muted small">${c.last_login_at ? fmtTime(c.last_login_at) : '-'}</td>
              <td>${c.is_active ? '<span class="badge badge-completed">正常</span>' : '<span class="badge badge-cancelled">已停用</span>'}</td>
              <td>${c.is_admin ? '<span class="muted small">—</span>'
                    : `<button class="btn btn-sm" data-ctoggle="${c.id}">${c.is_active ? '停用' : '启用'}</button>`}</td>
            </tr>`).join('') || '<tr><td colspan="9" class="muted center" style="padding:40px">没有客户</td></tr>'}
        </tbody>
      </table>
    </div>`;

  const k = document.getElementById('custKw');
  let t = null;
  k.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { A.custKeyword = k.value.trim(); viewCustomers(body); }, 350);
  });
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-ctoggle]');
  if (!b) return;
  try {
    const r = await adminRpc('yxls_admin_customer_toggle', { p_id: b.dataset.ctoggle });
    if (!r.ok) throw new Error(r.msg);
    toast('已更新', 'ok'); render();
  } catch (err) { toast(err.message, 'err'); }
});

/* --------------------------------------------------------------- 设置 */
const SETTING_FIELDS = [
  ['shop_name', '店铺名称'],
  ['notice', '首页公告'],
  ['contact_phone', '客服电话'],
  ['wechat', '客服微信'],
  ['address', '门店地址'],
  ['open_hours', '营业时间'],
  ['delivery_min', '起送金额（元，0=不限）'],
  ['delivery_fee', '配送费（元）'],
  ['footer_note', '页脚说明']
];

async function viewSettings(body) {
  const r = await adminRpc('yxls_admin_settings');
  A.settings = r.data || {};
  const u = Admin.user() || {};

  body.innerHTML = `
    <div class="card pad" style="max-width:640px">
      <div class="section-head"><h2>店铺信息</h2></div>
      ${SETTING_FIELDS.map(([k, label]) => `
        <div class="field"><label>${label}</label>
          <input class="input" data-set="${k}" value="${escapeHtml(A.settings[k] || '')}"></div>`).join('')}
      <button class="btn btn-primary btn-block" id="btnSaveSettings" style="margin-top:8px">保存设置</button>
    </div>

    <div class="card pad" style="max-width:640px;margin-top:16px">
      <div class="section-head"><h2>管理员信息</h2></div>
      <div class="field"><label>当前账号</label><input class="input" value="${escapeHtml(u.nickname || '')} · ${escapeHtml(u.phone || '')}" disabled></div>
      <div class="field"><label>原密码</label><input class="input" id="apOld" type="password"></div>
      <div class="field"><label>新密码（至少 6 位）</label><input class="input" id="apNew" type="password"></div>
      <button class="btn btn-block" id="btnChangePwd">修改管理员密码</button>
    </div>

    <div class="card pad" style="max-width:640px;margin-top:16px">
      <div class="section-head"><h2>系统标识</h2></div>
      <p class="hint">数据表前缀：<b class="mono">yxls_</b>　系统印记：<b class="mono">${escapeHtml(A.settings.signature || 'YXLS-v1')}</b><br>
      本项目所有后端对象均以 yxls_ 前缀命名，与数据库中其它项目完全隔离。</p>
    </div>`;

  document.getElementById('btnSaveSettings').onclick = async () => {
    const data = {};
    body.querySelectorAll('[data-set]').forEach(i => { data[i.dataset.set] = i.value; });
    try {
      const rr = await adminRpc('yxls_admin_setting_save', { p_data: data });
      if (!rr.ok) throw new Error(rr.msg);
      toast('设置已保存', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  };

  document.getElementById('btnChangePwd').onclick = async () => {
    const oldP = document.getElementById('apOld').value;
    const newP = document.getElementById('apNew').value;
    if (newP.length < 6) { toast('新密码至少 6 位', 'err'); return; }
    try {
      const rr = await adminRpc('yxls_password_change', { p_old: oldP, p_new: newP });
      if (!rr.ok) throw new Error(rr.msg);
      toast('密码已修改，请重新登录', 'ok');
      setTimeout(() => { Admin.clear(); showLogin(); }, 900);
    } catch (err) { toast(err.message, 'err'); }
  };
}

/* --------------------------------------------------------------- 启动 */
async function bootAdmin() {
  document.getElementById('lgBtn').onclick = doLogin;
  document.getElementById('lgPwd').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('lgPhone').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  document.getElementById('adminNav').onclick = e => {
    const b = e.target.closest('[data-view]');
    if (b) go(b.dataset.view);
  };
  document.getElementById('btnRefresh').onclick = () => render();
  document.getElementById('btnToShop').onclick = () => window.open('index.html', '_blank');
  document.getElementById('btnAdminLogout').onclick = async () => {
    try { await yxlsRpc('yxls_logout', { p_token: Admin.token() }); } catch (e) { /* 忽略 */ }
    Admin.clear();
    showLogin();
  };

  if (!Admin.token()) { showLogin(); return; }

  try {
    const r = await adminRpc('yxls_admin_stats');
    if (!r.ok) throw new Error(r.msg);
    showShell();
    go('overview');
  } catch (err) {
    showLogin();
  }
}

bootAdmin();
