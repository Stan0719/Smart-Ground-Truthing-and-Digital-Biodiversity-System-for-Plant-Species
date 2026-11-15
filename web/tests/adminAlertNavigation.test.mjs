import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import policy from '../../shared/rbac.cjs'

const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')

test('Administrator alert route is removed while Sensor Management and Officer alert routes retain their components and guards', async () => {
  let options, guard
  const operations = { name: 'AdminOperationsView' }
  const source = read('router/index.ts').replace('import.meta.env.BASE_URL', "'/'")
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(code, {
    exports: {},
    require(name) {
      if (name === 'vue-router') return {
        createWebHistory: () => ({}),
        createRouter(value) { options = value; return { beforeEach(value) { guard = value } } },
      }
      if (name.endsWith('/auth')) return { currentUser: async () => ({ role: 'Administrator', mustChangePassword: false }), logout: async () => {} }
      return { __esModule: true, default: name.endsWith('AdminOperationsView.vue') ? operations : {} }
    },
  })
  assert.ok(!options.routes.some(route => route.path === '/admin/alerts' || route.name === 'admin-alerts'))
  assert.equal(options.routes.find(route => route.path === '/admin/sensors').component, operations)
  for (const path of ['/admin', '/admin/users', '/admin/roles', '/admin/iot', '/admin/activity', '/admin/settings', '/admin/profile']) {
    assert.equal(options.routes.find(route => route.path === path).meta.requiresAdmin, true, path)
  }
  const officer = options.routes.find(route => route.path === '/conservation')
  assert.equal(officer.children.find(route => route.path === 'alerts').name, 'conservation-alerts')
  assert.equal(await guard({ path: '/admin/sensors' }), undefined)
  assert.equal((await guard({ path: '/conservation/alerts' })).name, 'home')
})

test('Administrator sidebar preserves the remaining ordered entries and has no Threat Alerts entry', () => {
  const source = read('components/AdminPageShell.vue')
  const items = source.slice(source.indexOf('const items = ['), source.indexOf('</script>'))
  assert.deepEqual([...items.matchAll(/to: '([^']+)'/g)].map(match => match[1]), [
    '/admin', '/admin/users', '/admin/roles', '/admin/iot', '/admin/sensors', '/admin/activity',
  ])
  assert.doesNotMatch(items, /Threat Alerts|threatAlerts/)
})

test('all frontend navigation avoids the deleted route and existing alert links use Administrator IoT', () => {
  const inspect = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
      if (entry.isDirectory()) inspect(url)
      else if (/\.(vue|ts)$/.test(entry.name)) assert.doesNotMatch(readFileSync(url, 'utf8'), /\/admin\/alerts|['"]admin-alerts['"]/, url.pathname)
    }
  }
  inspect(new URL('../src/', import.meta.url))
  assert.match(read('views/AdminDashboardView.vue'), /const openThreatAlerts[\s\S]*?name: 'admin-iot'/)
  assert.equal([...read('data/adminNotifications.ts').matchAll(/route: '\/admin\/iot'/g)].length, 3)
})

test('Administrator IoT keeps canonical alerts, preview, error retry and data mappings while the removed table is absent', () => {
  const source = read('views/AdminModuleView.vue')
  assert.match(source, /plantApi<AlertsResponse>\('\/alerts'\)/)
  assert.match(source, /liveAlerts\.value = alertsResult\.value\.alerts/)
  assert.match(source, /liveAlerts\.value\.slice\(0, 3\)/)
  assert.match(source, /alertsError[\s\S]*?@click="loadAdminIoTData"/)
  assert.match(source, /to="\/admin\/iot">View All Alerts/)
  const operations = read('views/AdminOperationsView.vue')
  assert.doesNotMatch(operations, /filteredAlerts|interface Alert|requested === 'alerts'|section === 'alerts'/)
  assert.match(operations, /plantApi<\{ provisioningKey: string \}>\('\/devices', 'POST'/)
  assert.match(operations, /\/thresholds`, 'PATCH'/)
})

test('alert read and response permissions retain the existing Administrator and Officer boundary', () => {
  const user = role => ({ role, status: 'Active', mustChangePassword: false })
  for (const role of ['Administrator', 'Conservation Officer']) assert.equal(policy.permitted(user(role), 'alerts.read'), true)
  assert.equal(policy.permitted(user('Administrator'), 'responses.manage'), false)
  assert.equal(policy.permitted(user('Conservation Officer'), 'responses.manage'), true)
})
