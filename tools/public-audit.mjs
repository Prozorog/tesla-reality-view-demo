#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

const blockedFolder = /(^|\/)(renders|shots|tmp|ref|assets-src)(\/|$)/i
const referenceName = /(^|\/)(park-|rv-0|model-x-user|x-side|x-front|x-rear|x-top)/i
const imageFile = /\.(avif|bmp|dds|exr|gif|hdr|heic|heif|ico|jpe?g|jxl|ktx2?|png|psd|svg|tga|tiff?|webp)$/i
const credentialsFile = /(^|\/)(\.env(?:\.[^/]*)?|\.npmrc|\.netrc|credentials(?:\.json)?|[^/]+\.(pem|key|p12|pfx))(\/|$)/i
const maxBytes = 50_000_000
const personalPatterns = {
  'private path': /[a-z]:[/\\]+(?:Users|Documents and Settings|Ai)[/\\]+/i,
  'email address': /[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/i,
  'local machine name': /\b(?:DESKTOP|LAPTOP)-[A-Z0-9]{7}\b/i,
  'token or private key': /\b(?:gh[pousr]_[\da-z]{30,}|github_pat_[\w]{30,}|sk-(?:proj-)?[\w-]{24,}|AKIA[\dA-Z]{16}|AIza[\w-]{35})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  'credential assignment': /(?:api[_-]?key|access[_-]?token|client[_-]?secret|authorization|cookie)\s*["']?\s*[:=]\s*["'](?:Bearer )?[\w.%+\/-]{12,}/i,
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function records(output) {
  return output.split('\0').filter(Boolean)
}

function pathIssues(path, bytes) {
  const issues = []
  if (blockedFolder.test(path) || referenceName.test(path) || (imageFile.test(path) && !/^(public|docs)\//i.test(path))) {
    issues.push('private material or image outside public/ and docs/')
  }
  if (credentialsFile.test(path)) issues.push('credentials file')
  if (bytes > maxBytes) issues.push(`file exceeds 50 MB (${bytes} bytes)`)
  return issues
}

function contentIssues(path, bytes) {
  let content = bytes
  if (path.endsWith('.glb') && bytes.length > 20 && bytes.toString('ascii', 0, 4) === 'glTF') {
    content = bytes.subarray(20, 20 + bytes.readUInt32LE(12))
  }
  if (content.includes(0)) return []
  const text = content.toString('utf8')
  return Object.entries(personalPatterns).filter(([, pattern]) => pattern.test(text)).map(([name]) => name)
}

function tree(ref) {
  return records(git('ls-tree', '-r', '-z', '-l', ref)).map(entry => {
    const tab = entry.indexOf('\t')
    const [mode, type, object, size] = entry.slice(0, tab).split(/ +/)
    return { path: entry.slice(tab + 1), mode, type, object, size: Number(size) }
  })
}

function audit(ref) {
  const entries = ref ? tree(ref) : records(git('ls-files', '-z')).map(path => ({ path, size: statSync(path).size }))
  const findings = []
  for (const { path, mode, type, object, size } of entries) {
    const issues = pathIssues(path, size)
    if (mode === '120000' || type === 'commit') issues.push('symlink or submodule requires manual review')
    if (!issues.length) {
      const bytes = ref ? execFileSync('git', ['cat-file', 'blob', object], { maxBuffer: maxBytes + 1 }) : readFileSync(path)
      issues.push(...contentIssues(path, bytes))
    }
    if (issues.length) findings.push({ path, issues })
  }
  return { scanned: entries.length, findings }
}

function prePush(input) {
  const checked = new Set()
  const privateRef = /^refs\/(?:heads\/private-history|tags\/tesla-rv-p1(?:\.[1-6]|-s[1-5]))$/
  for (const line of input.trim().split(/\r?\n/).filter(Boolean)) {
    const [localRef, local, remoteRef, remote] = line.split(/\s+/)
    if (/^0+$/.test(local)) continue
    if (privateRef.test(localRef) || privateRef.test(remoteRef)) throw new Error(`Private ref ${localRef}`)
    // Check the commit behind an annotated tag as well as every newly published commit.
    const exclusions = /^0+$/.test(remote) ? [] : [`^${remote}`]
    const commits = git('rev-list', `${local}^{commit}`, ...exclusions).trim().split('\n').filter(Boolean)
    for (const commit of commits) {
      if (checked.has(commit)) continue
      for (const { path, mode, type, size } of tree(commit)) {
        const issues = pathIssues(path, size)
        if (mode === '120000' || type === 'commit') issues.push('symlink or submodule requires manual review')
        if (issues.length) throw new Error(`${path} in ${commit.slice(0, 12)}: ${issues.join(', ')}`)
      }
      checked.add(commit)
    }
  }
}

try {
  if (process.argv[2] === '--pre-push') {
    prePush(readFileSync(0, 'utf8'))
  } else {
    const result = audit(process.argv[2])
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = result.findings.length ? 1 : 0
  }
} catch (error) {
  console.error(`Public audit refused the operation. ${error.message}`)
  process.exitCode = 1
}
