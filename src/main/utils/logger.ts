// 引入模块
import log from 'electron-log'
import dayjs from 'dayjs'

// 关闭控制台打印
log.transports.console.level = 'error'
log.transports.file.level = 'debug'
log.transports.file.maxSize = 10024300 // 文件最大不超过 10M
// 输出格式
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]{scope} {text}'
let dateStr = dayjs().format('YYYY-MM-DD')
// 文件位置及命名方式
// 默认位置为：C:\Users\[user]\AppData\Roaming\[appname]\electron_log\
// 文件名为：年-月-日.log
// 自定义文件保存位置为安装目录下 \log\年-月-日.log
log.transports.file.resolvePathFn = () => 'log\\' + dateStr + '.log'

export default log
