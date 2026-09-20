const http = require('http')
const port = process.env.PORT || process.env.SERVER_PORT || 3000
console.log('[ JOA-KING ] Bootstrap e2b677a: sin acceso a stdin')

global.__joaBootstrapServer = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({ name: 'JOA-KING', status: 'starting' }))
})

global.__joaBootstrapServer.listen(port, '0.0.0.0', () => {
  console.log(`[ ✿ ] Servidor web activo en el puerto ${port}`)
})

import('./index.js').catch((error) => {
  console.error('No se pudo iniciar JOA-KING:', error)
  process.exitCode = 1
})