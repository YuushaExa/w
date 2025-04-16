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
  pagination: fs.readFileSync(path.join('themes', config.template, 'pagination.html'), 'utf8'),
  taxonomy: fs.readFileSync(path.join('themes', config.template, 'taxonomy.html'), 'utf8'),
  terms: fs.readFileSync(path.join('themes', config.template, 'terms.html'), 'utf8')
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

// Generate pagination HTML
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

// Process taxonomies
async function processTaxonomies(allItems) {
  if (!config.taxonomies || !Array.isArray(config.taxonomies)) return;

  for (const taxonomy of config.taxonomies) {
    // Create taxonomy directory
    const taxonomyDir = path.join(config.outputDir, taxonomy);
    if (!fs.existsSync(taxonomyDir)) {
      fs.mkdirSync(taxonomyDir, { recursive: true });
    }

    // Collect all terms for this taxonomy
    const termsMap = new Map();

    for (const item of allItems) {
      if (item[taxonomy] && Array.isArray(item[taxonomy])) {
        for (const term of item[taxonomy]) {
          if (!termsMap.has(term.name || term)) {
            termsMap.set(term.name || term, []);
          }
          termsMap.get(term.name || term).push(item);
        }
      }
    }

    // Generate term pages (individual taxonomy pages)
    for (const [term, items] of termsMap) {
      const termSlug = term.toLowerCase().replace(/\s+/g, '-');
      const termPath = path.join(taxonomyDir, `${termSlug}.html`);
      
      // Generate paginated term pages if needed
      if (config.pagination) {
        const itemsPerPage = config.pagination.itemsPerPage;
        const totalPages = Math.ceil(items.length / itemsPerPage);
        const filenamePattern = config.pagination.filenamePattern || 'list-*.html';

        for (let page = 1; page <= totalPages; page++) {
          const pageItems = items.slice((page - 1) * itemsPerPage, page * itemsPerPage);
          const paginationHTML = getPaginationHTML(page, totalPages, filenamePattern);
          const outputPath = path.join(
            taxonomyDir,
            page === 1 ? `${termSlug}.html` : `${termSlug}-${page}.html`
          );
          generateHTML('taxonomy', { 
            items: pageItems, 
            term: term,
            taxonomy: taxonomy 
          }, outputPath, paginationHTML);
        }
      } else {
        generateHTML('taxonomy', { 
          items: items, 
          term: term,
          taxonomy: taxonomy 
        }, termPath);
      }
    }

    // Generate terms list page (all terms for this taxonomy)
    const termsList = Array.from(termsMap.keys()).map(term => ({
      name: term,
      slug: term.toLowerCase().replace(/\s+/g, '-'),
      count: termsMap.get(term).length
    }));

    generateHTML('terms', { 
      terms: termsList,
      taxonomy: taxonomy 
    }, path.join(taxonomyDir, 'index.html'));
  }
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

    // Create path directory if specified in config
    const basePath = config.path ? path.join(config.outputDir, config.path) : config.outputDir;
    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true });
    }

    // Generate individual pages
    for (const item of allItems) {
      generateHTML('single', item, path.join(basePath, `${item.id}.html`));
    }

    // Generate paginated list pages
    if (config.pagination) {
      const itemsPerPage = config.pagination.itemsPerPage;
      const totalPages = Math.ceil(allItems.length / itemsPerPage);
      const filenamePattern = config.pagination.filenamePattern || 'page-*.html';

      for (let page = 1; page <= totalPages; page++) {
        const pageItems = allItems.slice((page - 1) * itemsPerPage, page * itemsPerPage);
        const paginationHTML = getPaginationHTML(page, totalPages, filenamePattern);
        const outputPath = path.join(
          basePath,
          page === 1 ? 'index.html' : filenamePattern.replace('*', page)
        );
        generateHTML('list', { items: pageItems }, outputPath, paginationHTML);
      }
    } else {
      // Non-paginated fallback
      generateHTML('list', { items: allItems }, path.join(basePath, 'index.html'));
    }

    // Process taxonomies with the base path included
    await processTaxonomies(allItems, basePath);

    console.log('Site generation complete!');
  } catch (error) {
    console.error('Error generating site:', error);
  }
}

// Updated processTaxonomies function with basePath parameter
async function processTaxonomies(allItems, basePath) {
  if (!config.taxonomies || !Array.isArray(config.taxonomies)) return;

  for (const taxonomy of config.taxonomies) {
    // Create taxonomy directory within the base path
    const taxonomyDir = path.join(basePath, taxonomy);
    if (!fs.existsSync(taxonomyDir)) {
      fs.mkdirSync(taxonomyDir, { recursive: true });
    }
    }
}
generateSite();
