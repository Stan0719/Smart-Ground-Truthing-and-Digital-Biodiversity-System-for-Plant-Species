// Persistence boundary for users.name / visitors.name only. No email or auth changes.
const marker = 'niah:account-name:'
const prefix = marker + 'v2:'
const failure = () => Error('Account personal data could not be processed.')

export function createAccountNameStorage(encryptionProvider) {
  let encryption
  const crypto = () => {
    encryption ??= encryptionProvider()
    return encryption
  }
  const context = (table, id) => {
    if (!['users', 'visitors'].includes(table) || typeof id !== 'string' || !id)
      throw failure()
    return `account:${table}:${id}:name`
  }
  const encrypt = (value, table, id) => {
    try {
      if (typeof value !== 'string') throw failure()
      return prefix + JSON.stringify(crypto().encrypt(value, context(table, id)))
    } catch (error) {
      if (error?.code === 'DATA_ENCRYPTION_CONFIGURATION') throw error
      throw failure()
    }
  }

  return {
    // SQL comes from backend source, never from request input. Only the existing
    // single-row, parameterized account write forms are supported. Unknown forms
    // that write names fail closed instead of silently persisting plaintext.
    write(sql, values) {
      const insert = /^\s*INSERT\s+INTO\s+(users|visitors)\s*\(([^)]+)\)\s+VALUES\s*\(([^)]+)\)/i.exec(sql)
      const update = /^\s*UPDATE\s+(users|visitors)\s+SET\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/i.exec(sql)
      let table, nameBind, idBind
      if (insert) {
        const columns = insert[2].split(',').map(value => value.trim().replace(/^"([a-z_]+)"$/i, '$1').toLowerCase())
        if (!columns.includes('name')) return values
        const terms = insert[3].split(',').map(value => value.trim())
        table = insert[1].toLowerCase()
        nameBind = /^\$(\d+)$/.exec(terms[columns.indexOf('name')])
        idBind = /^\$(\d+)$/.exec(terms[columns.indexOf('id')])
        if (!/^\s*(?:RETURNING\b[\s\S]*)?$/i.test(sql.slice(insert[0].length))) throw failure()
      } else if (update && /\bname\s*=/i.test(update[2])) {
        table = update[1].toLowerCase()
        nameBind = /(?:^|,)\s*name\s*=\s*\$(\d+)\s*(?:,|$)/i.exec(update[2])
        idBind = /^\s*id\s*=\s*\$(\d+)\s*(?:RETURNING\b[\s\S]*)?$/i.exec(update[3])
      } else {
        if (/\bINSERT\s+INTO\s+(?:["a-z0-9_]+\.)?"?(users|visitors)\b/i.test(sql) ||
            (/\bUPDATE\s+(?:["a-z0-9_]+\.)?"?(users|visitors)\b/i.test(sql) && /\bname\b/i.test(sql)))
          throw failure()
        return values
      }
      if (!nameBind || !idBind) throw failure()
      if (nameBind[1] === idBind[1] ||
          (sql.match(/\$\d+\b/g) ?? []).filter(bind => bind === `$${nameBind[1]}`).length !== 1)
        throw failure()
      const bound = [...values]
      bound[Number(nameBind[1]) - 1] = encrypt(bound[Number(nameBind[1]) - 1], table, bound[Number(idBind[1]) - 1])
      return bound
    },
    read(rows) {
      for (const row of rows ?? []) {
        if (typeof row.name !== 'string' || !row.name.startsWith(marker)) continue
        try {
          if (!row.name.startsWith(prefix)) throw failure()
          const table = row.role === 'Visitor' ? 'visitors'
            : ['Administrator', 'Conservation Officer', 'Botanist'].includes(row.role) ? 'users' : null
          const envelope = JSON.parse(row.name.slice(prefix.length))
          const name = crypto().decrypt(envelope, context(table, row.id))
          if (typeof name !== 'string') throw failure()
          row.name = name
        } catch { throw failure() }
      }
      return rows
    },
  }
}
