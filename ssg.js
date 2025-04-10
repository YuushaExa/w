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

// Convert {{...}} syntax to template literals
function compileTemplate(template) {
  // Handle loops: {{#each items}}...{{/each}}
  template = template.replace(/\{\{#each ([^}]+)\}\}([\s\S]+?)\{\{\/each\}\}/g, (match, arrayPath, loopContent) => {
    return `\${${arrayPath}.map(item => \`${loopContent.replace(/\{\{([^}]+)\}\}/g, '${item.$1}')}\`).join('')}`;
  });

  // Handle conditionals: {{#if condition}}...{{/if}}
  template = template.replace(/\{\{#if ([^}]+)\}\}([\s\S]+?)\{\{\/if\}\}/g, (match, condition, ifContent) => {
    return `\${${condition} ? \`${ifContent}\` : ''}`;
  });

  // Handle simple placeholders: {{title}}
  template = template.replace(/\{\{([^}]+)\}\}/g, '${$1}');

  return template;
}

// Pre-compile templates
const compiledTemplates = {
  base: compileTemplate(templates.base),
  single: compileTemplate(templates.single),
  list: compileTemplate(templates.list)
};

// Generate HTML using compiled templates
function generateHTML(templateName, data, outputPath) {
  const template = compiledTemplates[templateName];
  const content = new Function('data', `return \`${template}\``)(data);
  
  const fullHTML = new Function('data', `return \`${compiledTemplates.base}\``)({ ...data, content });
  
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
