import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'

type SupportedLocale = 'en' | 'ms' | 'zh-CN'

const ms: Record<string, string> = {
  'Manage system users': 'Urus pengguna sistem',
  'View accounts, assign access roles, and manage user status.':
    'Lihat akaun, tetapkan peranan akses dan urus status pengguna.',
  'Role & Permission': 'Peranan & Kebenaran',
  'Review the predefined system roles and their assigned access permissions.':
    'Semak peranan sistem yang ditetapkan dan kebenaran aksesnya.',
  'IoT Monitoring': 'Pemantauan IoT',
  'Sensor Management': 'Pengurusan Sensor',
  'Threat Alerts': 'Amaran Ancaman',
  'System Activity': 'Aktiviti Sistem',
  'Manage official taxonomic, ecological and conservation information.':
    'Urus maklumat taksonomi, ekologi dan pemuliharaan rasmi.',
  'Browse time-specific measurements submitted by botanists without overwriting plant history.':
    'Semak ukuran mengikut masa yang dihantar oleh ahli botani tanpa menimpa sejarah tumbuhan.',
  'Verify botanist observations and preserve a clear review decision.':
    'Sahkan pemerhatian ahli botani dan simpan keputusan semakan yang jelas.',
  'Visualise internal plant records with exact authorised coordinates.':
    'Paparkan rekod tumbuhan dalaman dengan koordinat tepat yang dibenarkan.',
  'Review environmental and security events around monitored plants.':
    'Semak kejadian alam sekitar dan keselamatan di sekitar tumbuhan yang dipantau.',
  'Generate filtered period summaries from biodiversity records.':
    'Jana ringkasan tempoh yang ditapis daripada rekod biodiversiti.',
  'No users found': 'Tiada pengguna ditemui',
  'Try changing or clearing your filters.': 'Cuba ubah atau kosongkan penapis anda.',
  'No species match the selected filters.': 'Tiada spesies sepadan dengan penapis yang dipilih.',
  'No plant records match the selected filters.':
    'Tiada rekod tumbuhan sepadan dengan penapis yang dipilih.',
  'No sensor readings available yet.': 'Belum ada bacaan sensor.',
  'No response notes yet': 'Belum ada catatan respons',
  'No image evidence available.': 'Tiada bukti imej tersedia.',
  'Are you sure this threat has been investigated and resolved?':
    'Adakah anda pasti ancaman ini telah disiasat dan diselesaikan?',
  'This action cannot be undone.': 'Tindakan ini tidak boleh dibuat asal.',
  'This removes the account from the directory':
    'Ini akan mengalih keluar akaun daripada direktori',
  'Click to upload image': 'Klik untuk muat naik imej',
  'or upload from device': 'atau muat naik daripada peranti',
  'Current alert register': 'Daftar amaran semasa',
  'Current Filtered Results': 'Hasil ditapis semasa',
  'Use the search and activity filter currently applied to this page.':
    'Gunakan penapis carian dan aktiviti semasa pada halaman ini.',
  'Ignore page filters and use only the export options above.':
    'Abaikan penapis halaman dan gunakan pilihan eksport di atas sahaja.',
  'Coordinates are restricted to authorised internal users.':
    'Koordinat dihadkan kepada pengguna dalaman yang dibenarkan.',
  'Historical measurements remain separate records.':
    'Ukuran sejarah kekal sebagai rekod berasingan.',
}

const zh: Record<string, string> = {
  'Manage system users': '管理系统用户',
  'View accounts, assign access roles, and manage user status.':
    '查看账户、分配访问角色并管理用户状态。',
  'Role & Permission': '角色与权限',
  'Review the predefined system roles and their assigned access permissions.':
    '查看预设系统角色及其访问权限。',
  'IoT Monitoring': '物联网监控',
  'Sensor Management': '传感器管理',
  'Threat Alerts': '威胁警报',
  'System Activity': '系统活动',
  'Manage official taxonomic, ecological and conservation information.':
    '管理官方分类、生态和保育信息。',
  'Browse time-specific measurements submitted by botanists without overwriting plant history.':
    '浏览植物学家提交的定时测量数据，同时保留植物历史记录。',
  'Verify botanist observations and preserve a clear review decision.':
    '核实植物学家的观察记录，并保留清晰的审核决定。',
  'Visualise internal plant records with exact authorised coordinates.':
    '使用获授权的精确坐标显示内部植物记录。',
  'Review environmental and security events around monitored plants.':
    '审查受监测植物周围的环境与安全事件。',
  'Generate filtered period summaries from biodiversity records.':
    '根据生物多样性记录生成指定时段的筛选摘要。',
  'No users found': '未找到用户',
  'Try changing or clearing your filters.': '请尝试更改或清除筛选条件。',
  'No species match the selected filters.': '没有物种符合所选筛选条件。',
  'No plant records match the selected filters.': '没有植物记录符合所选筛选条件。',
  'No sensor readings available yet.': '暂无传感器读数。',
  'No response notes yet': '暂无响应记录',
  'No image evidence available.': '暂无图像证据。',
  'Are you sure this threat has been investigated and resolved?': '您确定此威胁已经调查并解决吗？',
  'This action cannot be undone.': '此操作无法撤销。',
  'This removes the account from the directory': '这会将该账户从目录中移除',
  'Click to upload image': '点击上传图片',
  'or upload from device': '或从设备上传',
  'Current alert register': '当前警报记录',
  'Current Filtered Results': '当前筛选结果',
  'Use the search and activity filter currently applied to this page.':
    '使用当前页面的搜索和活动筛选条件。',
  'Ignore page filters and use only the export options above.':
    '忽略页面筛选条件，仅使用以上导出选项。',
  'Coordinates are restricted to authorised internal users.': '坐标仅限获授权的内部用户查看。',
  'Historical measurements remain separate records.': '历史测量数据会保留为独立记录。',
}

const msTerms: Record<string, string> = {
  Actions: 'Tindakan',
  Action: 'Tindakan',
  Active: 'Aktif',
  Inactive: 'Tidak aktif',
  Suspended: 'Digantung',
  Status: 'Status',
  Search: 'Cari',
  Clear: 'Kosongkan',
  Cancel: 'Batal',
  Close: 'Tutup',
  View: 'Lihat',
  Edit: 'Sunting',
  Delete: 'Padam',
  Save: 'Simpan',
  Create: 'Cipta',
  Add: 'Tambah',
  Export: 'Eksport',
  Generate: 'Jana',
  Review: 'Semak',
  Resolve: 'Selesaikan',
  Reject: 'Tolak',
  Flag: 'Tandakan',
  Details: 'Butiran',
  History: 'Sejarah',
  Location: 'Lokasi',
  Date: 'Tarikh',
  Species: 'Spesies',
  Plant: 'Tumbuhan',
  Sensor: 'Sensor',
  Device: 'Peranti',
  User: 'Pengguna',
  Users: 'Pengguna',
  Role: 'Peranan',
  Permission: 'Kebenaran',
  Permissions: 'Kebenaran',
  Name: 'Nama',
  Description: 'Penerangan',
  Type: 'Jenis',
  Severity: 'Keterukan',
  High: 'Tinggi',
  Medium: 'Sederhana',
  Low: 'Rendah',
  New: 'Baharu',
  Reviewing: 'Dalam semakan',
  Resolved: 'Selesai',
  Online: 'Dalam talian',
  Offline: 'Luar talian',
  Maintenance: 'Penyelenggaraan',
  Total: 'Jumlah',
  Latest: 'Terkini',
  Recent: 'Terkini',
  Current: 'Semasa',
  All: 'Semua',
  None: 'Tiada',
  Health: 'Kesihatan',
  Height: 'Ketinggian',
  Family: 'Famili',
  Genus: 'Genus',
  Habitat: 'Habitat',
  Ecology: 'Ekologi',
  Conservation: 'Pemuliharaan',
  Observation: 'Pemerhatian',
  Observations: 'Pemerhatian',
  Report: 'Laporan',
  Reports: 'Laporan',
  Activity: 'Aktiviti',
  Alerts: 'Amaran',
  Alert: 'Amaran',
  Threat: 'Ancaman',
  Threats: 'Ancaman',
  Reading: 'Bacaan',
  Readings: 'Bacaan',
  Temperature: 'Suhu',
  Humidity: 'Kelembapan',
  Rainfall: 'Hujan',
  Motion: 'Pergerakan',
  Light: 'Cahaya',
  Coordinates: 'Koordinat',
  Latitude: 'Latitud',
  Longitude: 'Longitud',
  Accuracy: 'Ketepatan',
  Registered: 'Didaftarkan',
  Installed: 'Dipasang',
  Recorded: 'Direkodkan',
  Submitted: 'Dihantar',
  Approved: 'Diluluskan',
  Rejected: 'Ditolak',
  Pending: 'Menunggu',
  Required: 'Diperlukan',
  Information: 'Maklumat',
  Summary: 'Ringkasan',
  Filters: 'Penapis',
  Filter: 'Penapis',
  Password: 'Kata laluan',
  Email: 'E-mel',
  Visitor: 'Pelawat',
  Administrator: 'Pentadbir',
  Botanist: 'Ahli botani',
  Officer: 'Pegawai',
  System: 'Sistem',
  Public: 'Awam',
  Staff: 'Kakitangan',
  Account: 'Akaun',
  Accounts: 'Akaun',
  Module: 'Modul',
  Modules: 'Modul',
  Assigned: 'Ditugaskan',
  Select: 'Pilih',
  Upload: 'Muat naik',
  Photograph: 'Foto',
  Photographs: 'Foto',
  Evidence: 'Bukti',
  Response: 'Respons',
  Comment: 'Komen',
  Comments: 'Komen',
  Notes: 'Catatan',
  Morphology: 'Morfologi',
  Taxonomy: 'Taksonomi',
  Confidence: 'Keyakinan',
  Time: 'Masa',
  Today: 'Hari ini',
  From: 'Dari',
  To: 'Hingga',
}

const zhTerms: Record<string, string> = {
  Actions: '操作',
  Action: '操作',
  Active: '启用',
  Inactive: '停用',
  Suspended: '已暂停',
  Status: '状态',
  Search: '搜索',
  Clear: '清除',
  Cancel: '取消',
  Close: '关闭',
  View: '查看',
  Edit: '编辑',
  Delete: '删除',
  Save: '保存',
  Create: '创建',
  Add: '添加',
  Export: '导出',
  Generate: '生成',
  Review: '审核',
  Resolve: '解决',
  Reject: '拒绝',
  Flag: '标记',
  Details: '详情',
  History: '历史',
  Location: '位置',
  Date: '日期',
  Species: '物种',
  Plant: '植物',
  Sensor: '传感器',
  Device: '设备',
  User: '用户',
  Users: '用户',
  Role: '角色',
  Permission: '权限',
  Permissions: '权限',
  Name: '名称',
  Description: '说明',
  Type: '类型',
  Severity: '严重程度',
  High: '高',
  Medium: '中',
  Low: '低',
  New: '新建',
  Reviewing: '审核中',
  Resolved: '已解决',
  Online: '在线',
  Offline: '离线',
  Maintenance: '维护中',
  Total: '总数',
  Latest: '最新',
  Recent: '近期',
  Current: '当前',
  All: '所有',
  None: '无',
  Health: '健康状况',
  Height: '高度',
  Family: '科',
  Genus: '属',
  Habitat: '栖息地',
  Ecology: '生态',
  Conservation: '保育',
  Observation: '观察记录',
  Observations: '观察记录',
  Report: '报告',
  Reports: '报告',
  Activity: '活动',
  Alerts: '警报',
  Alert: '警报',
  Threat: '威胁',
  Threats: '威胁',
  Reading: '读数',
  Readings: '读数',
  Temperature: '温度',
  Humidity: '湿度',
  Rainfall: '降雨量',
  Motion: '移动',
  Light: '光照',
  Coordinates: '坐标',
  Latitude: '纬度',
  Longitude: '经度',
  Accuracy: '精度',
  Registered: '已登记',
  Installed: '已安装',
  Recorded: '已记录',
  Submitted: '已提交',
  Approved: '已批准',
  Rejected: '已拒绝',
  Pending: '待处理',
  Required: '必填',
  Information: '信息',
  Summary: '摘要',
  Filters: '筛选条件',
  Filter: '筛选',
  Password: '密码',
  Email: '电子邮件',
  Visitor: '访客',
  Administrator: '管理员',
  Botanist: '植物学家',
  Officer: '保育员',
  System: '系统',
  Public: '公众',
  Staff: '工作人员',
  Account: '账户',
  Accounts: '账户',
  Module: '模块',
  Modules: '模块',
  Assigned: '已分配',
  Select: '选择',
  Upload: '上传',
  Photograph: '照片',
  Photographs: '照片',
  Evidence: '证据',
  Response: '响应',
  Comment: '备注',
  Comments: '备注',
  Notes: '记录',
  Morphology: '形态',
  Taxonomy: '分类',
  Confidence: '置信度',
  Time: '时间',
  Today: '今天',
  From: '从',
  To: '至',
}

const originals = new WeakMap<Node, string>()
const attrOriginals = new WeakMap<Element, Map<string, string>>()

export function useAuthenticatedPageTranslation(rootSelector: string) {
  const { locale } = useI18n()
  let observer: MutationObserver | undefined
  const translate = (source: string, target: SupportedLocale) => {
    if (target === 'en') return source
    const exact = target === 'ms' ? ms[source] : zh[source]
    if (exact) return exact
    const terms = target === 'ms' ? msTerms : zhTerms
    let changed = false
    const result = source.replace(/[A-Za-z]+/g, (word) => {
      const translated = terms[word]
      if (translated) {
        changed = true
        return translated
      }
      return word
    })
    return changed ? result : source
  }
  const run = () => {
    const root = document.querySelector(rootSelector)
    if (!root) return
    const target = locale.value as SupportedLocale
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const current = node.textContent || ''
      if (!current.trim()) continue
      if (!originals.has(node)) originals.set(node, current)
      const source = originals.get(node) || current
      const leading = source.match(/^\s*/)?.[0] || ''
      const trailing = source.match(/\s*$/)?.[0] || ''
      const next = `${leading}${translate(source.trim(), target)}${trailing}`
      if (node.textContent !== next) node.textContent = next
    }
    root.querySelectorAll('[placeholder],[title],[aria-label]').forEach((element) => {
      const saved = attrOriginals.get(element) || new Map<string, string>()
      for (const attr of ['placeholder', 'title', 'aria-label']) {
        const current = element.getAttribute(attr)
        if (!current) continue
        if (!saved.has(attr)) saved.set(attr, current)
        const next = translate(saved.get(attr) || current, target)
        if (current !== next) element.setAttribute(attr, next)
      }
      attrOriginals.set(element, saved)
    })
  }
  onMounted(async () => {
    await nextTick()
    run()
    const root = document.querySelector(rootSelector)
    if (root) {
      observer = new MutationObserver(() => run())
      observer.observe(root, { childList: true, subtree: true })
    }
  })
  watch(locale, async () => {
    await nextTick()
    run()
  })
  onBeforeUnmount(() => observer?.disconnect())
}
