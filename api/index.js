const app = require('../app');

module.exports = (req, res) => {
  const requestUrl = new URL(req.url, 'http://localhost');
  const apiPath = requestUrl.searchParams.get('__api_path');
  if (apiPath) {
    requestUrl.pathname = `/api/${apiPath}`;
    requestUrl.searchParams.delete('__api_path');
    req.url = `${requestUrl.pathname}${requestUrl.search}`;
  }
  return app(req, res);
};