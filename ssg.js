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
  list: fs.readFileSync(path.join('themes', config.template, 'list.html'), 'utf8'),
  pagination: fs.readFileSync(path.join('themes', config.template, 'pagination.html'), 'utf8')
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

// Extract path function from template
function getPathFunction() {
  const pathFuncMatch = templates.pagination.match(/function getPagePath\(.*?\)\s*{([\s\S]*?)}/);
  if (!pathFuncMatch) throw new Error('Missing getPagePath() in pagination.html');
  return new Function('page', pathFuncMatch[1]);
}

// Generate pagination HTML and get current page path
function getPaginationInfo(currentPage, totalPages, getPagePath) {
  const html = new Function('currentPage', 'totalPages', 'getPagePath', `
    return \`${templates.pagination}\`;
  `)(currentPage, totalPages, getPagePath);
  
  return {
    html,
    currentPagePath: getPagePath(currentPage)
  };
}

// Generate HTML with template literals
function generateHTML(templateName, data, outputPath, pagination = '') {
  const template = templates[templateName];
  const content = new Function('data', 'pagination', `return \`${template}\``)(data, pagination);
  const fullHTML = new Function('data', `return \`${templates.base}\``)({ ...data, content });
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
      allItems.push(...(Array.isArray(data) ? data : [data]));
    }

    // Generate individual pages
    for (const item of allItems) {
      generateHTML('single', item, path.join(config.outputDir, `${item.id}.html`));
    }

    // Generate paginated list pages
    if (config.pagination) {
      const getPagePath = getPathFunction();
      const itemsPerPage = config.pagination;
      const totalPages = Math.ceil(allItems.length / itemsPerPage);

      for (let page = 1; page <= totalPages; page++) {
        const pageItems = allItems.slice(
          (page - 1) * itemsPerPage,
          page * itemsPerPage
        );

        const { html: paginationHTML, currentPagePath } = 
          getPaginationInfo(page, totalPages, getPagePath);
        
        generateHTML('list', { items: pageItems }, 
          path.join(config.outputDir, currentPagePath), 
          paginationHTML);
      }
    } else {
      // Non-paginated fallback
      generateHTML('list', { items: allItems }, 
        path.join(config.outputDir, 'index.html'));
    }

    console.log('Site generation complete!');
  } catch (error) {
    console.error('Error generating site:', error);
  }
}

// Run the generator
generateSite();
