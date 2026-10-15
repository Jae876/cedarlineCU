const app = require('./app');
const express = require('express');
const path = require('path');

const port = Number(process.env.PORT || 3000);

app.locals.ready.then(() => {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get(/^\/(?!api\/).*/, (_, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
  app.listen(port, () => {
    console.log(`Cedarline Community Credit Union available at http://localhost:${port}`);
  });
}).catch((error) => {
  console.error('Unable to initialize the database:', error.message);
  process.exitCode = 1;
});
