// Local stand-in for the deployed Apps Script web app: runs Code.gs against the fake sheet.
const http = require('http');
const { ctx } = require('./fake_sheet');
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const out = req.method === 'POST' ? ctx.doPost({ postData: { contents: body } }) : ctx.doGet();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(out.text);
  });
}).listen(8787, () => console.log('fake backend on 8787'));
