const fs = require('fs');
const path = require('path');
const https = require('https');

// Load configuration
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

// Ensure output directory exists
if (!fs.existsSync(config.outputDir)) {
  fs.mkdirSync(config.outputDir, { recursive: true });
}

// Load templates as template literals
function loadTemplate(fileName) {
  const templatePath = path.join('themes', config.template, fileName);
  return fs.readFileSync(templatePath, 'utf8');
}

const templates = {
  base: loadTemplate('baseof.html'),
  single: loadTemplate('single.html'),
  list: loadTemplate('list.html')
};

// Fetch data helper
async function fetchData(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

// Render template using literal substitution
function renderTemplate(template, data) {
  return template.replace(/\${([^}]+)}/g, (match, expression) => {
    try {
      // Create a function with the expression using the data as context
      const func = new Function('data', `with(data) { return ${expression} }`);
      const result = func(data);
      return result !== undefined ? result : '';
    } catch (e) {
      console.warn(`Template error in expression: ${expression}`);
      return '';
    }
  });
}

// Generate HTML files
function generateHTML(templateName, data, outputPath) {
  const template = templates[templateName];
  const content = renderTemplate(template, data);
  const fullHTML = renderTemplate(templates.base, { ...data, content });
  
  fs.writeFileSync(outputPath, fullHTML);
  console.log(`Generated: ${outputPath}`);
}

// Main generation function
async function generateSite() {
  try {
    // Load all data
    const allItems = [];
    for (const dataUrl of config.data) {
      const data = await fetchData(dataUrl);
      Array.isArray(data) ? allItems.push(...data) : allItems.push(data);
    }
    
    // Generate individual pages
    allItems.forEach(item => {
      generateHTML('single', item, path.join(config.outputDir, `${item.id}.html`));
    });
    
    // Generate list page
    generateHTML('list', { items: allItems }, path.join(config.outputDir, 'index.html'));
    
    console.log('Site generation complete!');
  } catch (error) {
    console.error('Error generating site:', error);
  }
}

generateSite();
