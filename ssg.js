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

// Helper function to fetch JSON data
async function fetchData(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

// Simple template engine
function renderTemplate(template, data) {
  let output = template;
  
  // Replace simple placeholders like {{title}}
  for (const [key, value] of Object.entries(data)) {
    output = output.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
  }
  
  // Handle nested objects with dot notation (like {{image.url}})
  output = output.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const parts = path.split('.');
    let value = data;
    for (const part of parts) {
      value = value?.[part];
      if (value === undefined) break;
    }
    return value || '';
  });
  
  return output;
}

// Generate HTML from template and data
function generateHTML(templateName, data, outputPath) {
  const template = templates[templateName];
  const content = renderTemplate(template, data);
  const fullHTML = renderTemplate(templates.base, { content });
  
  fs.writeFileSync(outputPath, fullHTML);
  console.log(`Generated: ${outputPath}`);
}

// Main generation function
async function generateSite() {
  try {
    // Load all data sources
    const allItems = [];
    
    for (const dataUrl of config.data) {
      const data = await fetchData(dataUrl);
      if (Array.isArray(data)) {
        allItems.push(...data);
      } else {
        allItems.push(data);
      }
    }
    
    // Generate individual pages
    for (const item of allItems) {
      const outputPath = path.join(config.outputDir, `${item.id}.html`);
      generateHTML('single', item, outputPath);
    }
    
    // Generate list page
    const listOutputPath = path.join(config.outputDir, 'index.html');
    generateHTML('list', { items: allItems }, listOutputPath);
    
    console.log('Site generation complete!');
  } catch (error) {
    console.error('Error generating site:', error);
  }
}

// Run the generator
generateSite();
