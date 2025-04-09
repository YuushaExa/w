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

// Enhanced template engine with loops and conditionals
function renderTemplate(template, data) {
  // Handle loops first
  let output = template.replace(/\{\{#each ([^}]+)\}\}([\s\S]+?)\{\{\/each\}\}/g, (match, arrayPath, loopContent) => {
    const parts = arrayPath.split('.');
    let array = data;
    for (const part of parts) {
      array = array?.[part];
      if (array === undefined) break;
    }
    
    if (!Array.isArray(array)) return '';
    
    return array.map(item => {
      return renderTemplate(loopContent, item);
    }).join('');
  });

  // Handle conditionals
  output = output.replace(/\{\{#if ([^}]+)\}\}([\s\S]+?)\{\{\/if\}\}/g, (match, conditionPath, ifContent) => {
    const parts = conditionPath.split('.');
    let value = data;
    for (const part of parts) {
      value = value?.[part];
      if (value === undefined) break;
    }
    
    // Check for array length
    if (conditionPath.endsWith('.length')) {
      const arrayPath = conditionPath.replace('.length', '');
      const array = getNestedValue(data, arrayPath);
      return Array.isArray(array) && array.length > 0 ? ifContent : '';
    }
    
    // Check for truthy value
    return value ? ifContent : '';
  });

  // Replace simple placeholders
  output = output.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    return getNestedValue(data, path) || '';
  });

  return output;
}

// Helper function to get nested values
function getNestedValue(obj, path) {
  const parts = path.split('.');
  let value = obj;
  for (const part of parts) {
    value = value?.[part];
    if (value === undefined) break;
  }
  return value;
}

// Generate HTML from template and data
function generateHTML(templateName, data, outputPath) {
  const template = templates[templateName];
  const content = renderTemplate(template, data);
  const fullHTML = renderTemplate(templates.base, { 
    ...data,
    content: content 
  });
  
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
