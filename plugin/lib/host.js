// 心跳急救 · 宿主半边（DSH 插件）
//
// 它证明的是：DSH 这个进程还活着、事件循环没堵死、网页那边还在跟它说话。
// 它不判定 DSH 到底该不该被杀 —— 那是外部「本体」（C:\ProgramData\DSH-Heartline）的活。
// 分工：本体是陪审团，插件只是证人。证人不能给自己打分。
//
// 三份证据：
//   host.beat.json   每秒一次，带 seq / mono_ms / tick_lag_ms（事件循环有没有被堵）
//   face             网页每 5 秒 POST 一次，证明渲染进程还在（页面卡死时这个会断）
//   ack_nonce        读到本体心跳就把它的 nonce 抄回来（双向通，不是自说自话）
//
// 只读本体心跳、只写自己的心跳和自己的日志。不杀进程、不拉进程 —— v0.2 仍然只看不动手。

import { promises as fs, writeFileSync, renameSync, existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID, randomBytes } from 'node:crypto'

export const inject = ['webServer', 'connection']

const 版本 = 'v0.2.1'
const 根 = join(homedir(), '.dsh', 'heartline')
const 宿主心跳 = join(根, 'host.beat.json')
const 本体心跳 = join(根, 'body.beat.json')
const 配置文件 = join(根, '设置.json')
const 事件文件 = join(根, 'host-事件.jsonl')
const 网页脚印 = join(根, 'face.json')

const 默认配置 = {
  心跳间隔秒: 1,
  判死秒: 20,          // 本体心跳超过这么久没更新 = 本体不在
  网页判死秒: 30,      // 网页脚印超过这么久没更新 = 界面卡了
  语音提醒: true,
  自动急救: false,     // 默认关：谁都不许在没有人的时候自己决定杀进程
}

const 实例 = randomUUID().slice(0, 8)
let 序号 = 0
let 上拍 = Date.now()
let 上一拍耗 = 0
let 最大抖动 = 0
let 最近本体 = null
let nonce环 = []      // 本体最近的 nonce，抄回去当回声
let 网页最后 = 0
let 定时器 = null
let 配置 = { ...默认配置 }

function 记(话, 细节) {
  try {
    const 行 = JSON.stringify({ t: new Date().toISOString(), m: 话, d: 细节 ?? null })
    appendFileSync(事件文件, 行 + '\n', 'utf8')
  } catch { }
}

function 读JSON(路径) {
  try { return JSON.parse(readFileSync(路径, 'utf8')) } catch { return null }
}

function 写原子(路径, 对象) {
  const 临时 = 路径 + '.tmp'
  const 文本 = JSON.stringify(对象)
  try {
    writeFileSync(临时, 文本, 'utf8')
    renameSync(临时, 路径)
    return true
  } catch {
    // 读方持锁时 rename 会撞（Windows 默认共享模式），退一步直接覆盖：丢一拍好过丢整条心跳
    try { writeFileSync(路径, 文本, 'utf8'); return true } catch { return false }
  }
}

function 读配置() {
  const c = 读JSON(配置文件)
  if (c && typeof c === 'object') {
    配置 = { ...默认配置, ...c }
  }
  return 配置
}

function 存配置(新) {
  const 合 = { ...配置 }
  for (const k of Object.keys(默认配置)) {
    if (新 && 新[k] !== undefined) {
      if (typeof 默认配置[k] === 'number') {
        const n = Number(新[k])
        if (Number.isFinite(n) && n > 0) 合[k] = n
      } else if (typeof 默认配置[k] === 'boolean') {
        合[k] = !!新[k]
      }
    }
  }
  合.心跳间隔秒 = Math.min(10, Math.max(1, Math.round(合.心跳间隔秒)))
  合.判死秒 = Math.min(600, Math.max(5, Math.round(合.判死秒)))
  合.网页判死秒 = Math.min(600, Math.max(5, Math.round(合.网页判死秒)))
  配置 = 合
  写原子(配置文件, 配置)
  重设定时器()
  return 配置
}

function 拍一次() {
  const 现在 = Date.now()
  上一拍耗 = 现在 - 上拍
  上拍 = 现在
  if (上一拍耗 - 配置.心跳间隔秒 * 1000 > 最大抖动) 最大抖动 = 上一拍耗 - 配置.心跳间隔秒 * 1000

  const 本体 = 读JSON(本体心跳)
  let 本体年龄 = null
  if (本体 && 本体.at) {
    本体年龄 = Math.round((现在 - Date.parse(本体.at)) / 1000)
    if (本体.nonce && !nonce环.includes(本体.nonce)) {
      nonce环.push(本体.nonce)
      if (nonce环.length > 4) nonce环 = nonce环.slice(-4)
    }
    最近本体 = 本体
  }
  const 网页 = 读JSON(网页脚印)
  网页最后 = 网页 && 网页.at ? Date.parse(网页.at) : 网页最后
  const 网页年龄 = 网页最后 ? Math.round((现在 - 网页最后) / 1000) : null

  序号++
  写原子(宿主心跳, {
    schema: 'dsh-heartline/1',
    who: 'host',
    version: 版本,
    pid: process.pid,
    instance_id: 实例,
    seq: 序号,
    at: new Date(现在).toISOString(),
    mono_ms: Math.round(performance.now()),
    tick_lag_ms: Math.max(0, Math.round(上一拍耗 - 配置.心跳间隔秒 * 1000)),
    max_lag_ms: Math.round(最大抖动),
    ack_nonce: nonce环[nonce环.length - 1] || null,
    ack_seq: 本体 ? 本体.seq ?? null : null,
    body_age_s: 本体年龄,
    face_age_s: 网页年龄,
  })
}

function 判定() {
  const 现在 = Date.now()
  const 本体 = 读JSON(本体心跳) || 最近本体
  const 宿主 = 读JSON(宿主心跳)
  const 本体年龄 = 本体 && 本体.at ? Math.round((现在 - Date.parse(本体.at)) / 1000) : null
  const 宿主年龄 = 宿主 && 宿主.at ? Math.round((现在 - Date.parse(宿主.at)) / 1000) : null
  const 网页年龄 = 读JSON(网页脚印)?.at ? Math.round((现在 - Date.parse(读JSON(网页脚印).at)) / 1000) : null

  let 本体状态 = 'UNKNOWN'
  if (本体年龄 !== null) {
    if (本体年龄 > 配置.判死秒) 本体状态 = 'GONE'
    else 本体状态 = 'ALIVE'
  }
  let 网页状态 = 'UNKNOWN'
  if (网页年龄 !== null) 网页状态 = 网页年龄 > 配置.网页判死秒 ? 'STALE' : 'ALIVE'

  return {
    version: 版本,
    host: { 状态: 宿主年龄 !== null && 宿主年龄 <= 配置.判死秒 ? 'ALIVE' : 'UNKNOWN', 年龄秒: 宿主年龄, 心跳: 宿主 },
    body: { 状态: 本体状态, 年龄秒: 本体年龄, 心跳: 本体 },
    face: { 状态: 网页状态, 年龄秒: 网页年龄 },
    config: 配置,
    dir: 根,
    现在: new Date(现在).toISOString(),
  }
}

function 重设定时器() {
  if (定时器) { clearInterval(定时器); 定时器 = null }
  定时器 = setInterval(() => { try { 拍一次() } catch (e) { 记('拍失败', String(e)) } }, 配置.心跳间隔秒 * 1000)
  if (定时器.unref) 定时器.unref()
}

function 发JSON(res, 码, 对象) {
  try {
    const 体 = JSON.stringify(对象)
    res.writeHead(码, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(体)
  } catch { }
}

function 读体(req) {
  return new Promise((resolve) => {
    let 块 = ''
    req.on('data', (c) => { 块 += c; if (块.length > 1e6) req.destroy() })
    req.on('end', () => { try { resolve(块 ? JSON.parse(块) : {}) } catch { resolve({}) } })
    req.on('error', () => resolve({}))
  })
}

// 只认本人：设置页点得动，外面来的点不动。
// DSH 自带的路由有登录校验，插件手挂的路由默认没有 —— 不补这一道，
// 本机上任何程序（包括随便哪个网页的 fetch）都能改阈值、把自动急救打开。
function 造门(ctx) {
  return function 只认本人(handler) {
    return async (req, res) => {
      try {
        const 连接 = ctx.get ? ctx.get('connection') : null
        const 拒 = 连接 && typeof 连接.requestRejection === 'function' ? 连接.requestRejection(req) : undefined
        if (拒 === 401 || 拒 === 403) {
          记('拒了一次外来请求', { 码: 拒, 方法: String((req && req.method) || ''), 路径: String((req && req.url) || '') })
          发JSON(res, 拒, { ok: false, 说: 拒 === 401 ? '需要登录' : '不允许' })
          return
        }
      } catch { /* 鉴权这条路自己坏了就放行：不能让设置页打不开 */ }
      return handler(req, res)
    }
  }
}

function 挂(ctx, 只认本人, 路径, handler) {
  ctx.webServer.register({ kind: 'exact', path: 路径, handler: 只认本人(handler) })
}

export function apply(ctx) {
  try { if (!existsSync(根)) mkdirSync(根, { recursive: true }) } catch { }
  读配置()
  记('宿主半边启动', { version: 版本, instance: 实例, dir: 根 })
  拍一次()
  重设定时器()

  ctx.effect(() => () => { if (定时器) clearInterval(定时器) })

  // 状态：设置页和外部脚本都读这一条
  挂(ctx, 只认本人, '/dsh-heartline/status', (req, res) => { 发JSON(res, 200, 判定()) })

  // 配置：读 / 改
  挂(ctx, 只认本人, '/dsh-heartline/config', async (req, res) => {
    if (req.method === 'POST') {
      const 体 = await 读体(req)
      const 新 = 存配置(体)
      记('改设置', 新)
      发JSON(res, 200, { ok: true, config: 新 })
      return
    }
    发JSON(res, 200, { ok: true, config: 配置 })
  })

  // 网页脚印：渲染进程每 5 秒踩一次。断了说明界面卡了（页面卡死时不会有人来踩）
  挂(ctx, 只认本人, '/dsh-heartline/face', async (req, res) => {
    const 体 = await 读体(req)
    网页最后 = Date.now()
    写原子(网页脚印, { at: new Date(网页最后).toISOString(), seq: 体 && 体.seq !== undefined ? 体.seq : null, client: String((体 && 体.client) || '').slice(0, 40) })
    发JSON(res, 200, { ok: true, host_seq: 序号 })
  })

  // 事件：最近 N 条，给设置页看
  挂(ctx, 只认本人, '/dsh-heartline/events', async (req, res) => {
    let 行 = []
    try {
      const 原文 = await fs.readFile(事件文件, 'utf8')
      行 = 原文.trim().split('\n').slice(-40).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    } catch { }
    发JSON(res, 200, { ok: true, items: 行 })
  })

  记('路由已挂（带鉴权）：status / config / face / events')
}