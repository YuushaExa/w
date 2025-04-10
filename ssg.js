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

// Helper to fetch JSON data
async function fetchData(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

// Generate paginated pages
function generatePaginatedList(allItems, outputDir) {
  const itemsPerPage = config.pagination || 10;
  const totalPages = Math.ceil(allItems.length / itemsPerPage);

  for (let i = 0; i < totalPages; i++) {
    const currentPage = i + 1;
    const startIdx = i * itemsPerPage;
    const endIdx = startIdx + itemsPerPage;
    const currentItems = allItems.slice(startIdx, endIdx);

    // Generate pagination HTML with ALL required variables
    const paginationHTML = new Function('data', `return \`${templates.pagination}\``)({
      totalPages,
      currentPage,
      itemsPerPage
    });

    // Generate list HTML with current items and pagination
    const listHTML = new Function('data', `return \`${templates.list}\``)({
      currentItems,
      pagination: paginationHTML
    });

    // Wrap in base template
    const fullHTML = new Function('data', `return \`${templates.base}\``)({
      title: `Page ${currentPage}`,
      content: listHTML
    });

    const fileName = i === 0 ? 'index.html' : `page${currentPage}.html`;
    fs.writeFileSync(path.join(outputDir, fileName), fullHTML);
    console.log(`Generated: ${fileName}`);
  }
}

// Main generation function
async function generateSite() {
  try {
    // Load all data
    const allItems = [];
    for (const dataUrl of config.data) {
      const data = await fetchData(dataUrl);
      allItems.push(...(Array.isArray(data) ? data : [data]));
    }

    // Generate individual item pages
    for (const item of allItems) {
      const outputPath = path.join(config.outputDir, `${item.id}.html`);
      const content = new Function('data', `return \`${templates.single}\``)(item);
      const fullHTML = new Function('data', `return \`${templates.base}\``)({ ...item, content });
      fs.writeFileSync(outputPath, fullHTML);
      console.log(`Generated: ${item.id}.html`);
    }

    // Generate paginated list pages
    generatePaginatedList(allItems, config.outputDir);

    console.log('Site generation complete!');
  } catch (error) {
    console.error('Error generating site:', error);
  }
}

// Run the generator
generateSite();
