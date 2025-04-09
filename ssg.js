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
    const array = getNestedValue(data, arrayPath);
    if (!Array.isArray(array)) return '';
    
    return array.map((item, index) => {
      // Create a new context with the current item and special variables
      const context = {
        ...item,
        '@index': index,
        '@first': index === 0,
        '@last': index === array.length - 1,
        '@root': data // Provide access to root data
      };
      
      // Render the item content with the new context
      return renderTemplate(loopContent, context);
    }).join('');
  });

  // Handle conditionals
  output = output.replace(/\{\{#if ([^}]+)\}\}([\s\S]+?)\{\{\/if\}\}/g, (match, condition, ifContent) => {
    const value = getNestedValue(data, condition);
    
    // Handle array checks
    if (Array.isArray(value)) return value.length > 0 ? renderTemplate(ifContent, data) : '';
    
    // Regular truthy check
    return value ? renderTemplate(ifContent, data) : '';
  });

  // Handle unless conditionals
  output = output.replace(/\{\{#unless ([^}]+)\}\}([\s\S]+?)\{\{\/unless\}\}/g, (match, condition, unlessContent) => {
    const value = getNestedValue(data, condition);
    return !value ? renderTemplate(unlessContent, data) : '';
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
    if (value === undefined) {
      console.log(`Could not resolve path part '${part}' in '${path}'`);
      console.log('Current object:', obj);
      break;
    }
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
