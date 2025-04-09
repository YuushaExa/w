const fs = require('fs');
const path = require('path');
const https = require('https');

// Load configuration
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

// Ensure output directory exists
if (!fs.existsSync(config.outputDir)) {
  fs.mkdirSync(config.outputDir, { recursive: true });
}

// Load templates
const templates = {
  base: fs.readFileSync(path.join('themes', config.template, 'baseof.html'), 'utf8'),
  single: fs.readFileSync(path.join('themes', config.template, 'single.html'), 'utf8'),
  list: fs.readFileSync(path.join('themes', config.template, 'list.html'), 'utf8')
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

// Safer template rendering
function renderTemplate(template, data) {
  // Handle conditionals and loops first
  let output = template
    .replace(/\${if ([^}]+)}([\s\S]+?)\${endif}/g, (match, condition, content) => {
      const value = getNestedValue(data, condition);
      return value ? content : '';
    })
    .replace(/\${each ([^}]+)}([\s\S]+?)\${endeach}/g, (match, arrayPath, content) => {
      const array = getNestedValue(data, arrayPath);
      if (!Array.isArray(array)) return '';
      return array.map(item => renderTemplate(content, item)).join('');
    });

  // Then handle simple expressions
  output = output.replace(/\${([^}]+)}/g, (match, expression) => {
    return getNestedValue(data, expression) || '';
  });

  return output;
}

// Helper to get nested values
function getNestedValue(obj, path) {
  return path.split('.').reduce((o, p) => o?.[p], obj);
}

// Generate HTML
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
