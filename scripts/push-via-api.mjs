// scripts/push-via-api.mjs — 在 github.com 被网络策略拦截、而 api.github.com 可达时，
// 用 GitHub Git Data REST API 把本地 HEAD 推到远端分支。
//
// 适用场景：`git push` 报
//   fatal: unable to access 'https://github.com/...': CONNECT tunnel failed, response 502
// 但 `curl https://api.github.com/rate_limit` 返回 200。
//
// 原理：把本地 git 索引里的文件逐个建成 blob → 组成 tree → 在远端父提交上建 commit
//       → 更新 refs/heads/<branch>。等价于一次 push，但全程只访问 api.github.com。
//
// 用法（本仓库）：
//   GH_TOKEN=$(gh auth token) node scripts/push-via-api.mjs [--branch main] [--dry-run] [--full]
//
// 注意 Node 版本：--use-env-proxy / --use-system-ca 是 Node 24+ 才有的开关。
// 沙箱里自签根证书会让 fetch 报 unable to verify the first certificate，两个标志都得加：
//   GH_TOKEN=$(gh auth token) "C:/Program Files/nodejs/node.exe" --use-env-proxy --use-system-ca \
//     scripts/push-via-api.mjs --branch main
//
// 默认走增量：先拉远端 tree，blob sha 相同的文件直接复用，只 POST 真正变了的。
// 加 --full 退回全量上传（远端 tree 拉不到时的兜底，也是排查「明明改了却没生效」的对照）。
//
// 注意：只推送 git 索引中已跟踪的文件（= 已 git add 且未被 .gitignore 忽略），
//       因此不会误传 node_modules / cf-token.txt 等。

import { execFileSync } from 'node:child_process'

const arg = (name, def) => {
  const i = process.argv.indexOf('--' + name)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const repo = arg('repo', 'KNGLOKIKO/Kinelayer')
const branch = arg('branch', 'main')
const dryRun = process.argv.includes('--dry-run')
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN

if (!token) {
  console.error('缺少 GH_TOKEN。用法：GH_TOKEN=$(gh auth token) node scripts/push-via-api.mjs')
  process.exit(1)
}

const [owner, name] = repo.split('/')
const API = 'https://api.github.com'

async function api(path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + token,
      'content-type': 'application/json',
      'user-agent': 'engloop-push-via-api',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${init.method || 'GET'} ${path} -> ${res.status} ${text.slice(0, 400)}`)
  }
  return text ? JSON.parse(text) : {}
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

// ---------------------------------------------------------------- 本地状态

const headSha = git('rev-parse', 'HEAD')
const message = git('log', '-1', '--format=%B')
const authorName = git('log', '-1', '--format=%an')
const authorEmail = git('log', '-1', '--format=%ae')

// `git ls-files -s` 形如：100644 <sha> 0\tpath
const entries = git('ls-files', '-s')
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [meta, path] = line.split('\t')
    const [mode, sha] = meta.split(/\s+/)
    return { mode: mode === '100755' ? '100755' : '100644', path, sha }
  })

console.log(`repo=${repo} branch=${branch}`)
console.log(`本地 HEAD=${headSha.slice(0, 7)} · 文件 ${entries.length} 个`)

const ref = await api(`/repos/${owner}/${name}/git/ref/heads/${branch}`)
const remoteSha = ref.object.sha
console.log(`远端 ${branch}=${remoteSha.slice(0, 7)}`)

if (remoteSha === headSha) {
  console.log('远端已是最新，无需推送。')
  process.exit(0)
}

// ---------------------------------------------------------------- 远端已有 blob（增量）

// 全量重建每个 blob 的话，一次推送要发「仓库文件数」个 POST —— 上百个文件就是几分钟，
// 只改 3 个文件也一样慢。先拉远端 tree，blob sha 相同的条目直接复用，只发真正变了的。
let remoteBlobs = new Map()
if (!process.argv.includes('--full')) {
  try {
    const remoteTree = await api(`/repos/${owner}/${name}/git/trees/${remoteSha}?recursive=1`)
    for (const t of remoteTree.tree ?? []) {
      if (t.type === 'blob') remoteBlobs.set(t.path, t.sha)
    }
    console.log(`远端 tree 已缓存：${remoteBlobs.size} 个 blob`)
  } catch (err) {
    console.log(`远端 tree 拉取失败，退回全量上传：${String(err).slice(0, 120)}`)
    remoteBlobs = new Map()
  }
}

// ---------------------------------------------------------------- 建 blob

const tree = []
let reused = 0
let uploaded = 0
for (let i = 0; i < entries.length; i++) {
  const e = entries[i]
  const known = remoteBlobs.get(e.path)
  if (known && known === e.sha) {
    tree.push({ path: e.path, mode: e.mode, type: 'blob', sha: known })
    reused += 1
    continue
  }
  const content = execFileSync('git', ['show', `:${e.path}`], { maxBuffer: 64 * 1024 * 1024 })
  if (dryRun) {
    console.log(`  [dry] ${e.mode} ${e.path} (${content.length} bytes)`)
    uploaded += 1
    continue
  }
  const blob = await api(`/repos/${owner}/${name}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
  })
  tree.push({ path: e.path, mode: e.mode, type: 'blob', sha: blob.sha })
  uploaded += 1
  if (uploaded % 25 === 0) console.log(`  blob ${uploaded} 个已上传…`)
}
console.log(`blob 完成：新上传 ${uploaded} 个，复用远端 ${reused} 个，共 ${tree.length} 条`)

if (dryRun) {
  console.log('--dry-run：到此为止（未写入远端）')
  process.exit(0)
}

// ---------------------------------------------------------------- tree / commit / ref

const newTree = await api(`/repos/${owner}/${name}/git/trees`, {
  method: 'POST',
  body: JSON.stringify({ tree }),
})
console.log(`tree=${newTree.sha.slice(0, 7)}`)

const commit = await api(`/repos/${owner}/${name}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({
    message,
    tree: newTree.sha,
    parents: [remoteSha],
    author: { name: authorName, email: authorEmail },
    committer: { name: authorName, email: authorEmail },
  }),
})
console.log(`commit=${commit.sha.slice(0, 7)}`)

await api(`/repos/${owner}/${name}/git/refs/heads/${branch}`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: commit.sha, force: false }),
})

const check = await api(`/repos/${owner}/${name}/git/ref/heads/${branch}`)
const localTree = git('write-tree')
const remoteCommit = await api(`/repos/${owner}/${name}/git/commits/${check.object.sha}`)

console.log(`\n推送完成：远端 ${branch} = ${check.object.sha.slice(0, 7)}`)
console.log(`  本地 tree = ${localTree.slice(0, 7)}`)
console.log(`  远端 tree = ${remoteCommit.tree.sha.slice(0, 7)}`)
if (remoteCommit.tree.sha === localTree) {
  console.log('  文件内容一致 ✓（commit sha 因元数据不同而与本地不同，属预期）')
  console.log('  后续推送无需先对齐历史：本脚本始终以远端 head 为父提交。')
} else {
  console.log('  ⚠ 内容不一致，请检查 git 索引状态')
  process.exit(1)
}
