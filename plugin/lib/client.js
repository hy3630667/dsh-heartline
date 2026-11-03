// 心跳急救 · 网页半边
// 在设置左侧栏加一项「心跳急救」：看三份心跳还新不新鲜，改判定阈值。
// 这里只读 /dsh-heartline/* 的路由，不碰会话、不发消息、不动进程。

window.__ModuleLoader__.load({
  id: 'dsh-heartline',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const inject = ['slots']
    const B = '/dsh-heartline'
    const h = React.createElement

    const 取 = (p) => fetch(B + p, { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
    const 存 = (p, 体) => fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(体 || {}) }).then((r) => r.json()).catch(() => null)

    const S = {
      区: {
        padding: '12px 14px 24px',
        fontSize: 13,
        lineHeight: 1.7,
        background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,.92))',
        border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08))',
        borderRadius: 12,
      },
      题: { fontSize: 14, fontWeight: 600, margin: '18px 0 8px' },
      淡: { opacity: 0.62, fontSize: 12 },
      卡: { border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1))', borderRadius: 8, padding: '10px 12px', margin: '8px 0', background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,.02))' },
      行: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '2px 0' },
      键: { opacity: 0.66 },
      值: { fontVariantNumeric: 'tabular-nums' },
      好: { color: 'var(--dsw-alias-text-success, #1a7f37)', fontWeight: 600 },
      坏: { color: 'var(--dsw-alias-text-danger, #c62828)', fontWeight: 600 },
      中: { color: 'var(--dsw-alias-text-warning, #9a6700)', fontWeight: 600 },
      输入: { width: 90, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.15))', background: 'transparent', color: 'inherit' },
      钮: { padding: '5px 14px', borderRadius: 7, border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.16))', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 13 },
    }

    const 色 = (状态) => (状态 === 'ALIVE' ? S.好 : 状态 === 'GONE' || 状态 === 'STALE' ? S.坏 : S.中)

    function 一行(名, 值, 样式) {
      return h('div', { style: S.行 }, h('span', { style: S.键 }, 名), h('span', { style: 样式 || S.值 }, 值))
    }

    function Section() {
      const [状态, 设状态] = React.useState(null)
      const [配置, 设配置] = React.useState(null)
      const [错, 设错] = React.useState('')
      const [忙, 设忙] = React.useState(false)
      const [说, 设说] = React.useState('')

      const 拉 = React.useCallback(async () => {
        const s = await 取('/status')
        if (s) { 设状态(s); 设配置((c) => c || s.config) } else 设错('读不到 /dsh-heartline/status')
      }, [])

      React.useEffect(() => {
        拉()
        const t = setInterval(拉, 2000)
        // 网页脚印：证明界面还活着。卡住的时候这个循环会停，宿主那边就看得到
        let n = 0
        const f = setInterval(() => { fetch(B + '/face', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seq: ++n, client: 'settings' }) }).catch(() => {}) }, 5000)
        fetch(B + '/face', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seq: 0, client: 'settings' }) }).catch(() => {})
        return () => { clearInterval(t); clearInterval(f) }
      }, [拉])

      const 存配置 = async () => {
        设忙(true); 设说('')
        const r = await 存('/config', 配置)
        设忙(false)
        if (r && r.ok) { 设配置(r.config); 设说('已保存') ; 拉() } else 设说('保存失败')
      }

      if (!状态 || !配置) {
        return h('div', { style: S.区 }, h('div', { style: S.淡 }, 错 || '正在读心跳…'))
      }

      const 本体 = 状态.body || {}
      const 宿主 = 状态.host || {}
      const 网页 = 状态.face || {}

      return h('div', { style: S.区 },
        h('div', { style: S.题 }, '心跳急救 ' + (状态.version || '')),

        h('div', { style: S.卡 },
          一行('本体（外部判定器）', (本体.状态 || 'UNKNOWN') + '　' + (本体.年龄秒 === null ? '没有心跳' : 本体.年龄秒 + ' 秒前'), 色(本体.状态)),
          一行('DSH 宿主（这个进程）', (宿主.状态 || 'UNKNOWN') + '　' + (宿主.年龄秒 === null ? '没有心跳' : 宿主.年龄秒 + ' 秒前'), 色(宿主.状态)),
          一行('网页界面', 网页.年龄秒 === null ? '还没踩过脚印' : (网页.状态 + '　' + 网页.年龄秒 + ' 秒前'), 色(网页.状态)),
          宿主.心跳 && 宿主.心跳.tick_lag_ms !== undefined
            ? 一行('事件循环抖动', 宿主.心跳.tick_lag_ms + ' ms（峰值 ' + (宿主.心跳.max_lag_ms || 0) + ' ms）')
            : null,
          宿主.心跳 && 宿主.心跳.ack_nonce
            ? 一行('回声（抄回本体的 nonce）', String(宿主.心跳.ack_nonce).slice(0, 12) + '…', S.好)
            : 一行('回声（抄回本体的 nonce）', '还没收到本体心跳', S.中),
        ),

        h('div', { style: S.题 }, '判定阈值'),
        h('div', { style: S.卡 },
          h('div', { style: S.行 },
            h('span', { style: S.键 }, '心跳间隔（秒）'),
            h('input', { style: S.输入, type: 'number', min: 1, max: 10, value: 配置.心跳间隔秒, onChange: (e) => 设配置({ ...配置, 心跳间隔秒: Number(e.target.value) }) }),
          ),
          h('div', { style: S.行 },
            h('span', { style: S.键 }, '多久没心跳算它不在（秒）'),
            h('input', { style: S.输入, type: 'number', min: 5, max: 600, value: 配置.判死秒, onChange: (e) => 设配置({ ...配置, 判死秒: Number(e.target.value) }) }),
          ),
          h('div', { style: S.行 },
            h('span', { style: S.键 }, '界面多久没踩脚印算卡了（秒）'),
            h('input', { style: S.输入, type: 'number', min: 5, max: 600, value: 配置.网页判死秒, onChange: (e) => 设配置({ ...配置, 网页判死秒: Number(e.target.value) }) }),
          ),
          h('div', { style: S.行 },
            h('span', { style: S.键 }, '出事时语音喊人'),
            h('input', { type: 'checkbox', checked: !!配置.语音提醒, onChange: (e) => 设配置({ ...配置, 语音提醒: e.target.checked }) }),
          ),
          h('div', { style: S.行 },
            h('span', { style: S.键 }, '自动急救（自己决定杀进程并重拉）'),
            h('input', { type: 'checkbox', checked: !!配置.自动急救, onChange: (e) => 设配置({ ...配置, 自动急救: e.target.checked }) }),
          ),
          h('div', { style: { ...S.淡, marginTop: 4 } }, '自动急救默认关。谁都不该在没有人的时候自己决定杀进程；打开前先想清楚。'),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 } },
            h('button', { style: S.钮, onClick: 存配置, disabled: 忙 }, 忙 ? '保存中…' : '保存设置'),
            说 ? h('span', { style: S.淡 }, 说) : null,
          ),
        ),

        h('div', { style: S.题 }, '文件在哪'),
        h('div', { style: S.卡 },
          一行('心跳与判定', 状态.dir || ''),
          一行('运行的本体', 'C:\\ProgramData\\DSH-Heartline\\current\\急救本体.ps1'),
          一行('源码仓库', 'D:\\项目\\dsh-heartline（GitHub: hy3630667/dsh-heartline）'),
        ),

        h('div', { style: { ...S.淡, marginTop: 10 } }, '插件只是证人：它证明自己活着，不判定自己该不该被杀。杀与拉由外部本体和看护负责。'),
      )
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () =>
        slots.register(
          { name: 'settings.section', id: 'heartline', order: 57, label: () => '心跳急救' },
          Section,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})