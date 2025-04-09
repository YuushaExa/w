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
// Enhanced template engine with better conditionals and loops
function renderTemplate(template, data) {
  // Handle loops first
  let output = template.replace(/\{\{#each ([^}]+)\}\}([\s\S]+?)\{\{\/each\}\}/g, (match, arrayPath, loopContent) => {
    const array = getNestedValue(data, arrayPath);
    if (!Array.isArray(array)) return '';
    
    return array.map((item, index) => {
      let itemOutput = loopContent;
      // Handle @last special variable
      itemOutput = itemOutput.replace(/\{\{\@last\}\}/g, index === array.length - 1);
      // Render the item content
      return renderTemplate(itemOutput, item);
    }).join('');
  });
if (condition.endsWith('.length')) {
  const arrayPath = condition.replace('.length', '');
  const array = getNestedValue(data, arrayPath);
  console.log(`Checking condition: ${condition} on data:`, data); // Log data context
  console.log(`  - Found array for ${arrayPath}:`, array);
  console.log(`  - IsArray: ${Array.isArray(array)}, Length: ${array?.length}`);
  const shouldRender = Array.isArray(array) && array.length > 0;
  console.log(`  - Should render content? ${shouldRender}`);
  return shouldRender ? ifContent : '';
}
  // Handle conditionals
// In renderTemplate function, replace the condition handling with:
output = output.replace(/\{\{#if ([^}]+)\}\}([\s\S]+?)\{\{\/if\}\}/g, (match, condition, ifContent) => {
  const value = getNestedValue(data, condition);
  
  // Handle array checks
  if (Array.isArray(value)) {
    return value.length > 0 ? ifContent : '';
  }
  
  // Handle other falsy values
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
