const fs = require('fs');
const path = require('path');
const https = require('https');

// Load config
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

// Generate pagination HTML (pure template evaluation)
function getPaginationHTML(currentPage, totalPages) {
  const filenamePattern = config.pagination?.filenamePattern || 'list-*.html';
  return new Function(
    'currentPage', 
    'totalPages',
    'filenamePattern',
    `return \`${templates.pagination}\``
  )(currentPage, totalPages, filenamePattern);
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
    // Load data
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
      const itemsPerPage = config.pagination;
      const totalPages = Math.ceil(allItems.length / itemsPerPage);

      for (let page = 1; page <= totalPages; page++) {
        const pageItems = allItems.slice((page - 1) * itemsPerPage, page * itemsPerPage);
        const paginationHTML = getPaginationHTML(page, totalPages);
       const outputPath = path.join(
  config.outputDir,
  page === 1 ? 'index.html' : config.pagination.filenamePattern.replace('{page}', page)
);
        generateHTML('list', { items: pageItems }, outputPath, paginationHTML);
      }
    } else {
      // Non-paginated fallback
      generateHTML('list', { items: allItems }, path.join(config.outputDir, 'index.html'));
    }

    console.log('Site generation complete!');
  } catch (error) {
    console.error('Error generating site:', error);
  }
}

generateSite();
