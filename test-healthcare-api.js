const http = require('http');

const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsImlhdCI6MTc2MTg1MTE4NSwiZXhwIjoxNzY0NDQzMTg1fQ.5-eqZUSywc4586pzRas2YIv-Ii2C8I7i9FvYzVttE9s';

const options = {
  hostname: 'localhost',
  port: 5003,
  path: '/api/healthcare/expenses?simulation=1',
  method: 'GET',
  headers: {
    'Authorization': token
  }
};

const req = http.request(options, (res) => {
  let data = '';

  console.log('Status Code:', res.statusCode);

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('Response:', data);
    try {
      const json = JSON.parse(data);
      console.log('\nParsed JSON:');
      if (Array.isArray(json)) {
        console.log(`Found ${json.length} expenses`);
        if (json.length > 0) {
          console.log('\nFirst expense:');
          console.log(JSON.stringify(json[0], null, 2));
          console.log('\nHSA Reimbursed values:');
          json.forEach((exp, i) => {
            console.log(`${i + 1}. ${exp.name}: hsaReimbursed = ${exp.hsaReimbursed}`);
          });
        }
      } else {
        console.log(JSON.stringify(json, null, 2));
      }
    } catch (e) {
      console.error('Failed to parse JSON:', e.message);
    }
  });
});

req.on('error', (e) => {
  console.error(`Request error: ${e.message}`);
});

req.end();
