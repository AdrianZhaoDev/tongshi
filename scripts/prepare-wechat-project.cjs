const fs = require('node:fs')
const path = require('node:path')

const mode = process.argv[2] || 'dev'
if (!['dev', 'build'].includes(mode) || process.argv.length > 3) {
  console.error('用法：npm run wechat:project -- dev|build')
  process.exit(1)
}

const root = path.resolve(__dirname, '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/manifest.json'), 'utf8'))
const appid = manifest['mp-weixin']?.appid
if (typeof appid !== 'string' || !/^wx[a-f\d]{16}$/i.test(appid)) {
  console.error('请先在 src/manifest.json 的 mp-weixin.appid 填写真实小程序 AppID；不会生成假 AppID 或游客配置。')
  process.exit(1)
}

const miniprogramRoot = `dist/${mode}/mp-weixin/`
if (!fs.existsSync(path.join(root, miniprogramRoot, 'app.json'))) {
  console.error(`缺少 ${miniprogramRoot}app.json；请先运行 npm run ${mode === 'dev' ? 'dev' : 'build'}:mp-weixin。`)
  process.exit(1)
}

const config = {
  appid,
  projectname: 'tongshi',
  compileType: 'miniprogram',
  miniprogramRoot,
  cloudfunctionRoot: 'cloudfunctions/',
  setting: { urlCheck: true, es6: true, minified: mode === 'build' },
}
fs.writeFileSync(path.join(root, 'project.config.json'), `${JSON.stringify(config, null, 2)}\n`)
console.log(`已生成微信开发者工具项目配置：小程序目录 ${miniprogramRoot}，云函数目录 cloudfunctions/。`)
console.log('导入仓库根目录；此命令不会创建云资源、部署云函数、发布小程序或发送消息。')
