const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ============ 数据存储 ============ */
const DATA_FILE = path.join('/tmp', 'yd_data.json');
let store = { users: [], tasks: [], rooms: [], messages: [], scores: [], logs: [], seq: { task: 0, room: 0, msg: 0, user: 0, score: 0, log: 0 } };

function loadStore() {
  try { if (fs.existsSync(DATA_FILE)) store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { console.log('loadStore error', e.message); }
}
function saveStore() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(store)); }
  catch (e) { console.log('saveStore error', e.message); }
}
function nextId(key) { store.seq[key] = (store.seq[key] || 0) + 1; return store.seq[key]; }
function now() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function genNo() {
  const d = new Date();
  return 'RW' + d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0') + String(Math.floor(Math.random()*9000)+1000);
}
function log(taskId, user, action, detail) {
  store.logs.push({ id: nextId('log'), task_id: taskId, user_name: user, action, detail: detail || '', create_time: now() });
  saveStore();
}

/* ============ 预置账号 ============ */
const PRESET_USERS = [
  { name: '张所', role: '所领导' },
  { name: '刘队长', role: '打击队长' },
  { name: '陈副队', role: '副队长' },
  { name: '张警官', role: '主办人(民警)' },
  { name: '李警官', role: '普通民警' },
  { name: '王辅警', role: '辅警' },
  { name: '赵辅警', role: '辅警' },
  { name: '陈联络员', role: '警务联络员' },
  { name: '孙保安', role: '保安员' },
  { name: '周法制', role: '法制员' },
  { name: '吴内勤', role: '内勤人员' },
  { name: '郑指挥', role: '综合指挥室' },
  { name: '王社区', role: '社区警务队' },
  { name: '审审计', role: '审计员' },
  { name: '系统管理员', role: '系统管理员' }
];

/* ============ 权限表 ============ */
const PERM = {
  '所领导':       { create: true,  first: false, final: true,  scope: 'all' },
  '打击队长':     { create: true,  first: true,  final: true,  scope: 'team' },
  '副队长':       { create: true,  first: true,  final: false, scope: 'team' },
  '主办人(民警)': { create: true,  first: false, final: false, scope: 'self' },
  '综合指挥室':   { create: true,  first: false, final: false, scope: 'all' },
  '社区警务队':   { create: true,  first: false, final: false, scope: 'self' },
  '法制员':       { create: false, first: true,  final: false, scope: 'all', onlyType: '执法整改' },
  '内勤人员':     { create: true,  first: false, final: false, scope: 'all' },
  '普通民警':     { create: true,  first: false, final: false, scope: 'self' },
  '辅警':         { create: true,  first: false, final: false, scope: 'self' },
  '警务联络员':   { create: false, first: false, final: false, scope: 'self' },
  '保安员':       { create: false, first: false, final: false, scope: 'self' },
  '审计员':       { create: false, first: false, final: false, scope: 'all' },
  '系统管理员':   { create: false, first: false, final: false, scope: 'all' }
};

function getPerm(role) { return PERM[role] || PERM['普通民警']; }

loadStore();
if (!store.users.length) {
  PRESET_USERS.forEach(u => {
    store.users.push({ id: nextId('user'), name: u.name, role: u.role, team: '', create_time: now() });
  });
  saveStore();
}

/* ============ 登录 ============ */
app.post('/api/login', (req, res) => {
  const { name, password } = req.body;
  if (!name) return res.status(400).json({ error: '请输入姓名' });
  if (password !== '123456') return res.status(400).json({ error: '密码错误（演示密码：123456）' });
  let u = store.users.find(x => x.name === name);
  if (!u) return res.status(404).json({ error: '账号不存在，请选择预置账号' });
  res.json({ ...u, perm: getPerm(u.role) });
});

app.get('/api/users', (req, res) => res.json(store.users));

/* ============ 任务列表（按角色过滤） ============ */
app.get('/api/tasks', (req, res) => {
  const { name } = req.query;
  const user = store.users.find(x => x.name === name);
  if (!user) return res.json([]);
  const p = getPerm(user.role);
  let rows = [...store.tasks].reverse();

  if (p.scope === 'self') {
    rows = rows.filter(t => t.host_user === name || (t.assist_users || '').includes(name));
  } else if (p.scope === 'team') {
    // 本组：简化处理，同队即视为本组（demo 里所有人同组）
  }
  // scope=all 不过滤

  rows.forEach(t => {
    t.msgCount = store.messages.filter(m => m.task_id === t.id).length;
    // 计算是否可审
    if (user.role === '打击队长') t.canFinal = t.status === 'FIRST_REVIEW' || (t.status === 'REVIEW' && t.host_user !== name);
    if (user.role === '副队长') t.canFirst = t.status === 'REVIEW' && t.host_user !== name;
    if (user.role === '所领导') t.canFinal = t.status === 'FIRST_REVIEW';
    if (user.role === '法制员') t.canFirst = t.status === 'REVIEW' && t.task_type === '执法整改' && t.host_user !== name;
  });
  res.json(rows);
});

/* ============ 任务详情 ============ */
app.get('/api/task/:id', (req, res) => {
  const t = store.tasks.find(x => x.id == req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  const out = { ...t };
  out.msgs = store.messages.filter(m => m.task_id === t.id);
  out.room = store.rooms.find(r => r.task_id === t.id);
  res.json(out);
});

/* ============ 新建任务 ============ */
app.post('/api/task', (req, res) => {
  const { title, task_type, host_user, assist_users, end_time, result_req, case_no, priority, operator } = req.body;
  const user = store.users.find(x => x.name === operator);
  if (!user) return res.status(403).json({ error: '用户不存在' });
  if (!getPerm(user.role).create) return res.status(403).json({ error: '您无新建任务权限' });
  if (!title || !task_type || !host_user) return res.status(400).json({ error: '缺少必填项' });

  const no = genNo();
  const t = {
    id: nextId('task'), task_no: no, title, task_type,
    source: '', case_no: case_no || '', priority: priority || 2,
    host_user, assist_users: (assist_users || []).join(','),
    start_time: now(), end_time: end_time || '',
    status: 'PENDING', result_req: result_req || '',
    progress: 0, score: 0, reviewed: 0, first_reviewer: '', create_time: now()
  };
  store.tasks.push(t);
  const room = { id: nextId('room'), task_id: t.id, room_code: 'ROOM_' + no, status: 'ACTIVE', create_time: now() };
  store.rooms.push(room);
  store.messages.push({ id: nextId('msg'), task_id: t.id, room_id: room.id, msg_type: 'SYSTEM', content: '任务「' + title + '」已创建，协作室自动开启', sender: '系统', is_sys: 1, create_time: now() });
  log(t.id, operator, 'CREATE_TASK', title);
  saveStore();
  res.json({ id: t.id, task_no: no });
});

/* ============ 更新进度 ============ */
app.put('/api/task/:id/progress', (req, res) => {
  const { progress, operator } = req.body;
  const t = store.tasks.find(x => x.id == req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  t.progress = progress;
  const room = store.rooms.find(r => r.task_id === t.id);
  store.messages.push({ id: nextId('msg'), task_id: t.id, room_id: room ? room.id : 0, msg_type: 'SYSTEM', content: '进度更新为 ' + progress + '%（' + (operator || '') + '）', sender: '系统', is_sys: 1, create_time: now() });
  log(t.id, operator || '', 'PROGRESS', progress + '%');
  saveStore();
  res.json({ ok: true });
});

/* ============ 发消息 ============ */
app.post('/api/task/:id/message', (req, res) => {
  const { content, sender } = req.body;
  if (!content || !sender) return res.status(400).json({ error: '内容或发送人缺失' });
  const t = store.tasks.find(x => x.id == req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  const room = store.rooms.find(r => r.task_id === t.id);
  if (!room || room.status === 'READONLY') return res.status(403).json({ error: '协作室已归档，禁止发言' });
  const SENS = ['涉密', '机密', '绝密', '身份证号'];
  for (const w of SENS) if (content.includes(w)) return res.status(400).json({ error: '含敏感词「' + w + '」，已拦截' });
  store.messages.push({ id: nextId('msg'), task_id: t.id, room_id: room.id, msg_type: 'TEXT', content, sender, is_sys: 0, create_time: now() });
  log(t.id, sender, 'SEND_MSG', content.slice(0, 50));
  saveStore();
  res.json({ ok: true });
});

/* ============ 提交成果 ============ */
app.post('/api/task/:id/submit', (req, res) => {
  const { content, operator } = req.body;
  const t = store.tasks.find(x => x.id == req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  t.status = 'REVIEW';
  const room = store.rooms.find(r => r.task_id === t.id);
  store.messages.push({ id: nextId('msg'), task_id: t.id, room_id: room ? room.id : 0, msg_type: 'CARD', content: '【成果提交】' + content, sender: operator || t.host_user, is_sys: 0, create_time: now() });
  log(t.id, operator || '', 'SUBMIT', content.slice(0, 50));
  saveStore();
  res.json({ ok: true });
});

/* ============ 审核（初审/终审） ============ */
app.post('/api/task/:id/review', (req, res) => {
  const { pass, operator } = req.body;
  const t = store.tasks.find(x => x.id == req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  const user = store.users.find(x => x.name === operator);
  if (!user) return res.status(403).json({ error: '用户不存在' });
  const p = getPerm(user.role);

  // 计算积分
  const base = { '专项攻坚': 5, '线索核查': 3, '执法整改': 2, '案件协作': 5, '值班督办': 2, '培训学习': 1, '临时任务': 1 }[t.task_type] || 1;

  if (!pass) {
    // 退回
    t.status = 'RUNNING';
    const room = store.rooms.find(r => r.task_id === t.id);
    store.messages.push({ id: nextId('msg'), task_id: t.id, room_id: room ? room.id : 0, msg_type: 'SYSTEM', content: '审核退回，请修改后重新提交', sender: '系统', is_sys: 1, create_time: now() });
    log(t.id, operator, 'REVIEW_REJECT', '');
    saveStore();
    return res.json({ ok: true });
  }

  // 副队长初审
  if (p.first && !p.final) {
    if (t.host_user === operator) return res.status(403).json({ error: '不能审核自己创建的任务' });
    t.status = 'FIRST_REVIEW';
    t.first_reviewer = operator;
    const room = store.rooms.find(r => r.task_id === t.id);
    store.messages.push({ id: nextId('msg'), task_id: t.id, room_id: room ? room.id : 0, msg_type: 'SYSTEM', content: '副队长初审通过，等待队长终审', sender: '系统', is_sys: 1, create_time: now() });
    log(t.id, operator, 'FIRST_REVIEW_PASS', '');
    saveStore();
    return res.json({ ok: true, stage: 'first' });
  }

  // 队长终审 或 所领导终审
  if (p.final) {
    t.status = 'DONE';
    t.reviewed = 1;
    t.score = base;
    t.progress = 100;
    store.scores.push({ id: nextId('score'), task_id: t.id, user_name: t.host_user, score: base, reason: t.title + ' 完成', create_time: now() });
    const room = store.rooms.find(r => r.task_id === t.id);
    if (room) room.status = 'READONLY';
    store.messages.push({ id: nextId('msg'), task_id: t.id, room_id: room ? room.id : 0, msg_type: 'SYSTEM', content: '终审通过，积分 +' + base + '，协作室已归档只读', sender: '系统', is_sys: 1, create_time: now() });
    log(t.id, operator, 'FINAL_REVIEW_PASS', '积分+' + base);
    saveStore();
    return res.json({ ok: true, stage: 'final' });
  }

  // 法制员审执法整改
  if (p.onlyType === '执法整改') {
    if (t.task_type !== '执法整改') return res.status(403).json({ error: '法制员只能审执法整改任务' });
    t.status = 'FIRST_REVIEW';
    t.first_reviewer = operator;
    const room = store.rooms.find(r => r.task_id === t.id);
    store.messages.push({ id: nextId('msg'), task_id: t.id, room_id: room ? room.id : 0, msg_type: 'SYSTEM', content: '法制员审核通过，等待队长终审', sender: '系统', is_sys: 1, create_time: now() });
    log(t.id, operator, 'LEGAL_REVIEW_PASS', '');
    saveStore();
    return res.json({ ok: true, stage: 'first' });
  }

  res.status(403).json({ error: '您无审核权限' });
});

/* ============ 积分 ============ */
app.get('/api/scores', (req, res) => {
  const { user } = req.query;
  let rows = [...store.scores].reverse();
  if (user) rows = rows.filter(s => s.user_name === user);
  res.json(rows);
});

/* ============ 待办统计 ============ */
app.get('/api/todo', (req, res) => {
  const { name } = req.query;
  const user = store.users.find(x => x.name === name);
  if (!user) return res.json({ pending: 0, review: 0, final: 0, overdue: 0, total: 0 });
  const p = getPerm(user.role);
  const nowStr = now();

  let pending = 0, review = 0, final = 0, overdue = 0;

  store.tasks.forEach(t => {
    const mine = t.host_user === name || (t.assist_users || '').includes(name);
    if (t.status === 'PENDING' && mine) pending++;
    if (t.status === 'RUNNING' && mine && t.end_time && t.end_time < nowStr) overdue++;
    // 待我审
    if (t.status === 'REVIEW') {
      if (user.role === '副队长' && t.host_user !== name) review++;
      if (user.role === '打击队长' && t.host_user !== name) review++;
      if (user.role === '法制员' && t.task_type === '执法整改') review++;
    }
    // 待我终审
    if (t.status === 'FIRST_REVIEW') {
      if (user.role === '打击队长' || user.role === '所领导') final++;
    }
  });

  res.json({ pending, review, final, overdue, total: pending + review + final + overdue });
});

/* ============ 超期检查（24小时自动终审） ============ */
setInterval(() => {
  const nowStr = now();
  store.tasks.forEach(t => {
    // 24小时自动通过
    if (t.status === 'FIRST_REVIEW' && t.first_review_time) {
      const diff = (new Date(nowStr) - new Date(t.first_review_time)) / 3600000;
      if (diff >= 24) {
        const base = { '专项攻坚': 5, '线索核查': 3, '执法整改': 2, '案件协作': 5, '值班督办': 2, '培训学习': 1, '临时任务': 1 }[t.task_type] || 1;
        t.status = 'DONE'; t.reviewed = 1; t.score = base; t.progress = 100;
        store.scores.push({ id: nextId('score'), task_id: t.id, user_name: t.host_user, score: base, reason: t.title + ' 完成（超24h自动终审）', create_time: now() });
        const room = store.rooms.find(r => r.task_id === t.id);
        if (room) room.status = 'READONLY';
        store.messages.push({ id: nextId('msg'), task_id: t.id, room_id: room ? room.id : 0, msg_type: 'SYSTEM', content: '队长超24小时未终审，系统自动通过，积分 +' + base, sender: '系统', is_sys: 1, create_time: now() });
      }
    }
  });
}, 60000);
// 记录初审时间
const origReview = app._router.stack.find(l => l.route && l.route.path === '/api/task/:id/review');
if (origReview) {
  const origHandler = origReview.route.stack[0].handle;
  origReview.route.stack[0].handle = function(req, res, next) {
    const t = store.tasks.find(x => x.id == req.params.id);
    if (t && t.status === 'REVIEW') t.first_review_time = now();
    return origHandler.call(this, req, res, next);
  };
}

/* ============ 审计日志 ============ */
app.get('/api/logs', (req, res) => {
  const { name } = req.query;
  const user = store.users.find(x => x.name === name);
  if (!user || !['审计员', '系统管理员'].includes(user.role)) return res.status(403).json({ error: '无权限' });
  res.json([...store.logs].reverse().slice(0, 200));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('永定绩效系统已启动，端口：' + PORT);
});
