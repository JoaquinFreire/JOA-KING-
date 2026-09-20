import('./index.js').catch((error) => {
  console.error('No se pudo iniciar JOA-KING:', error)
  process.exitCode = 1
})