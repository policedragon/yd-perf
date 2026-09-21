const express = require('express');
const sqlite3 = require('better-sqlite3');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const db = new sqlite3(path.join(__dirname, 'data.db'));

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

db.exec(`
CREATE TABLE IF NOT EXISTS t_user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL,
  team TEXT,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS t_task (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_no TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  task_type TEXT NOT NULL,
  source TEXT,
  case_no TEXT,
  priority INTEGER DEFAULT 2,
  host_user TEXT NOT NULL,
  assist_users TEXT,
  start_time DATETIME,
  end_time DATETIME,
  status TEXT DEFAULT 'PENDING',
  result_req TEXT,
  progress INTEGER DEFAULT 0,
  score INTEGER DEFAULT 0,
  reviewed INTEGER DEFAULT 0,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS t_task_room (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER UNIQUE NOT NULL,
  room_code TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'ACTIVE',
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS t_chat_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  room_id INTEGER NOT NULL,
  msg_type TEXT DEFAULT 'TEXT',
  content TEXT,
  sender TEXT,
  is_sys INTEGER DEFAULT 0,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS t_task_score (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  user_name TEXT NOT NULL,
  score REAL NOT NULL,
  reason TEXT,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS t_task_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  user_name TEXT,
  action TEXT,
  detail TEXT,
  create_time DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

function genNo() {
  const d = new Date();
  const ymd = d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
  const rand = String(Math.floor(Math.random()*9000)+1000);
  return 'RW' + ymd + rand;
}
function log(taskId, user, action, detail) {
  db.prepare('INSERT INTO t_task_log (task_id,user_name,action,detail) VALUES (?,?,?,?)')
    .run(taskId, user, action, detail || '');
}

app.get('/api/users', (req,res) => {
  res.json(db.prepare('SELECT * FROM t_user ORDER BY id').all());
});

app.post('/api/user/login', (req,res) => {
  const { name, role, team } = req.body;
  if (!name || !role) return res.status(400).json({ error: '姓名和角色必填' });
  let u = db.prepare('SELECT * FROM t_user WHERE name=?').get(name);
  if (!u) {
    db.prepare('INSERT INTO t_user (name,role,team) VALUES (?,?,?)').run(name, role, team||'');
    u = db.prepare('SELECT * FROM t_user WHERE name=?').get(name);
  } else if (u.role !== role) {
    db.prepare('UPDATE t_user SET role=? WHERE name=?').run(role, name);
    u.role = role;
  }
  res.json(u);
});

app.get('/api/tasks', (req,res) => {
  const { user } = req.query;
  let rows;
  if (user) {
    rows = db.prepare("SELECT * FROM t_task WHERE host_user=? OR assist_users LIKE ? ORDER BY id DESC")
      .all(user, '%'+user+'%');
  } else {
    rows = db.prepare('SELECT * FROM t_task ORDER BY id DESC').all();
  }
  rows.forEach(t => {
    t.msgCount = db.prepare('SELECT COUNT(*) c FROM t_chat_message WHERE task_id=?').get(t.id).c;
  });
  res.json(rows);
});

app.get('/api/task/:id', (req,res) => {
  const t = db.prepare('SELECT * FROM t_task WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  t.msgs = db.prepare('SELECT * FROM t_chat_message WHERE task_id=? ORDER BY id').all(t.id);
  t.room = db.prepare('SELECT * FROM t_task_room WHERE task_id=?').get(t.id);
  res.json(t);
});

app.post('/api/task', (req,res) => {
  const { title, task_type, host_user, assist_users, end_time, result_req, case_no, priority, operator } = req.body;
  if (!title || !task_type || !host_user) return res.status(400).json({ error: '缺少必填项' });
  const no = genNo();
  const info = db.prepare("INSERT INTO t_task (task_no,title,task_type,host_user,assist_users,end_time,result_req,case_no,priority,status,start_time) VALUES (?,?,?,?,?,?,?,?,?, 'PENDING', datetime('now'))")
    .run(no, title, task_type, host_user, (assist_users||[]).join(','), end_time, result_req||'', case_no||'', priority||2);
  const taskId = info.lastInsertRowid;
  db.prepare('INSERT INTO t_task_room (task_id, room_code, status) VALUES (?,?,?)').run(taskId, 'ROOM_'+no, 'ACTIVE');
  const room = db.prepare('SELECT * FROM t_task_room WHERE task_id=?').get(taskId);
  db.prepare("INSERT INTO t_chat_message (task_id,room_id,msg_type,content,sender,is_sys) VALUES (?,?, 'SYSTEM', ?, '系统', 1)")
    .run(taskId, room.id, '任务「'+title+'」已创建，协作室自动开启');
  log(taskId, operator||host_user, 'CREATE_TASK', title);
  res.json({ id: taskId, task_no: no });
});

app.put('/api/task/:id/status', (req,res) => {
  const { status, operator } = req.body;
  const t = db.prepare('SELECT * FROM t_task WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  db.prepare('UPDATE t_task SET status=? WHERE id=?').run(status, t.id);
  if (status === 'ARCHIVED' || status === 'DONE') {
    db.prepare('UPDATE t_task_room SET status=? WHERE task_id=?').run('READONLY', t.id);
    const room = db.prepare('SELECT id FROM t_task_room WHERE task_id=?').get(t.id);
    db.prepare("INSERT INTO t_chat_message (task_id,room_id,msg_type,content,sender,is_sys) VALUES (?,?, 'SYSTEM', '任务已归档，协作室永久只读，仅供溯源查阅', '系统', 1)")
      .run(t.id, room.id);
  }
  log(t.id, operator||'', 'STATUS_CHANGE', status);
  res.json({ ok: true });
});

app.put('/api/task/:id/progress', (req,res) => {
  const { progress, operator } = req.body;
  const t = db.prepare('SELECT * FROM t_task WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  db.prepare('UPDATE t_task SET progress=? WHERE id=?').run(progress, t.id);
  const room = db.prepare('SELECT * FROM t_task_room WHERE task_id=?').get(t.id);
  db.prepare("INSERT INTO t_chat_message (task_id,room_id,msg_type,content,sender,is_sys) VALUES (?,?, 'SYSTEM', ?, '系统', 1)")
    .run(t.id, room.id, '进度更新为 ' + progress + '%（' + (operator||'') + '）');
  log(t.id, operator||'', 'PROGRESS', progress+'%');
  res.json({ ok: true });
});

app.get('/api/task/:id/messages', (req,res) => {
  res.json(db.prepare('SELECT * FROM t_chat_message WHERE task_id=? ORDER BY id').all(req.params.id));
});

app.post('/api/task/:id/message', (req,res) => {
  const { content, sender } = req.body;
  if (!content || !sender) return res.status(400).json({ error: '内容或发送人缺失' });
  const t = db.prepare('SELECT * FROM t_task WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  const room = db.prepare('SELECT * FROM t_task_room WHERE task_id=?').get(t.id);
  if (!room || room.status === 'READONLY') return res.status(403).json({ error: '协作室已归档，禁止发言' });
  const SENS = ['涉密','机密','绝密','身份证号'];
  for (const w of SENS) if (content.includes(w)) return res.status(400).json({ error: '含敏感词「'+w+'」，已拦截' });
  db.prepare("INSERT INTO t_chat_message (task_id,room_id,msg_type,content,sender,is_sys) VALUES (?,?, 'TEXT', ?, ?, 0)")
    .run(t.id, room.id, content, sender);
  log(t.id, sender, 'SEND_MSG', content.slice(0,50));
  res.json({ ok: true });
});

app.post('/api/task/:id/submit', (req,res) => {
  const { content, operator } = req.body;
  const t = db.prepare('SELECT * FROM t_task WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  db.prepare('UPDATE t_task SET status=? WHERE id=?').run('REVIEW', t.id);
  const room = db.prepare('SELECT * FROM t_task_room WHERE task_id=?').get(t.id);
  db.prepare("INSERT INTO t_chat_message (task_id,room_id,msg_type,content,sender,is_sys) VALUES (?,?, 'CARD', ?, ?, 0)")
    .run(t.id, room.id, '【成果提交】'+content, operator||t.host_user);
  log(t.id, operator||'', 'SUBMIT', content.slice(0,50));
  res.json({ ok: true });
});

app.post('/api/task/:id/review', (req,res) => {
  const { pass, operator, evaluate } = req.body;
  const t = db.prepare('SELECT * FROM t_task WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  if (pass) {
    const base = { '专项攻坚':5, '线索核查':3, '执法整改':2, '案件协作':5, '值班督办':2, '培训学习':1, '临时任务':1 }[t.task_type] || 1;
    db.prepare('UPDATE t_task SET status=?, reviewed=1, score=?, progress=100 WHERE id=?').run('DONE', base, t.id);
    db.prepare('INSERT INTO t_task_score (task_id,user_name,score,reason) VALUES (?,?,?,?)')
      .run(t.id, t.host_user, base, t.title+' 按时完成');
    db.prepare('UPDATE t_task_room SET status=? WHERE task_id=?').run('READONLY', t.id);
    const room = db.prepare('SELECT id FROM t_task_room WHERE task_id=?').get(t.id);
    db.prepare("INSERT INTO t_chat_message (task_id,room_id,msg_type,content,sender,is_sys) VALUES (?,?, 'SYSTEM', ?, '系统', 1)")
      .run(t.id, room.id, '审核通过，积分 +'+base+'，协作室已归档只读');
    log(t.id, operator||'', 'REVIEW_PASS', '积分+'+base);
  } else {
    db.prepare('UPDATE t_task SET status=? WHERE id=?').run('RUNNING', t.id);
    log(t.id, operator||'', 'REVIEW_REJECT', evaluate||'');
  }
  res.json({ ok: true });
});

app.get('/api/scores', (req,res) => {
  const { user } = req.query;
  let rows;
  if (user) rows = db.prepare('SELECT * FROM t_task_score WHERE user_name=? ORDER BY id DESC').all(user);
  else rows = db.prepare('SELECT * FROM t_task_score ORDER BY id DESC').all();
  res.json(rows);
});

app.get('/api/overdue', (req,res) => {
  const now = new Date().toISOString().slice(0,16).replace('T',' ');
  const rows = db.prepare("SELECT * FROM t_task WHERE status IN ('PENDING','RUNNING') AND end_time IS NOT NULL AND end_time < ?").all(now);
  res.json(rows);
});

app.get('/api/logs', (req,res) => {
  res.json(db.prepare('SELECT * FROM t_task_log ORDER BY id DESC LIMIT 200').all());
});

app.listen(PORT, () => {
  console.log('永定绩效系统已启动：http://localhost:' + PORT);
});
