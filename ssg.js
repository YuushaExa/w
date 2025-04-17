const fs = require('fs');
const path = require('path');
const https = require('https');

// Basic slugify function
function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

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

// Generate clean path URLs for links
function cleanPath(url) {
  return url.replace(/\.html$/, '');
}

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

// Generate pagination HTML with clean paths
function getPaginationHTML(currentPage, totalPages, basePath) {
  return new Function(
    'currentPage',
    'totalPages',
    'basePath',
    'cleanPath',
    `return \`${templates.pagination}\``
  )(currentPage, totalPages, basePath, cleanPath);
}

// Generate HTML with clean paths
function generateHTML(templateName, data, outputPath, pagination = '') {
  const template = templates[templateName];
  
  const context = {
    ...data,
    pagination,
    slugify,
    cleanPath
  };

  const content = new Function(
    'data',
    `with(data) { return \`${template}\` }`
  )(context);

  const fullHTML = new Function(
    'data',
    `with(data) { return \`${templates.base}\` }`
  )({ ...context, content });

  fs.writeFileSync(outputPath, fullHTML);
  console.log(`Generated: ${outputPath}`);
}

// Process taxonomies
async function processTaxonomies(allItems, basePath) {
  if (!config.taxonomies || !Array.isArray(config.taxonomies)) return;

  for (const taxonomy of config.taxonomies) {
    const taxonomySlug = slugify(taxonomy);
    const taxonomyDir = path.join(basePath, taxonomySlug);
    
    if (!fs.existsSync(taxonomyDir)) {
      fs.mkdirSync(taxonomyDir, { recursive: true });
    }

    const termsMap = new Map();

    for (const item of allItems) {
      if (item[taxonomy] && Array.isArray(item[taxonomy])) {
        for (const term of item[taxonomy]) {
          const termName = term.name || term;
          const termSlug = slugify(termName);
          
          if (!termsMap.has(termSlug)) {
            termsMap.set(termSlug, {
              name: termName,
              items: []
            });
          }
          termsMap.get(termSlug).items.push(item);
        }
      }
    }

    // Generate term pages
    for (const [termSlug, termData] of termsMap) {
      const { name, items } = termData;
      
      if (config.pagination) {
        const itemsPerPage = config.pagination.itemsPerPage;
        const totalPages = Math.ceil(items.length / itemsPerPage);

        for (let page = 1; page <= totalPages; page++) {
          const pageItems = items.slice((page - 1) * itemsPerPage, page * itemsPerPage);
          const paginationHTML = getPaginationHTML(
            page,
            totalPages,
            `${taxonomySlug}/${termSlug}`,
            cleanPath
          );
          
          const outputPath = path.join(
            taxonomyDir,
            page === 1 ? `${termSlug}.html` : `${termSlug}-page-${page}.html`
          );
          
          generateHTML('taxonomy', {
            items: pageItems,
            term: name,
            taxonomy: taxonomy
          }, outputPath, paginationHTML);
        }
      } else {
        generateHTML('taxonomy', {
          items: items,
          term: name,
          taxonomy: taxonomy
        }, path.join(taxonomyDir, `${termSlug}.html`));
      }
    }

    // Generate terms list page
    const termsList = Array.from(termsMap.entries()).map(([slug, termData]) => ({
      name: termData.name,
      slug: slug,
      count: termData.items.length
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

    // Create base directory
    const basePath = config.path ? path.join(config.outputDir, slugify(config.path)) : config.outputDir;
    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true });
    }

    // Generate individual game pages
    const gamesDir = path.join(basePath, 'games');
    if (!fs.existsSync(gamesDir)) {
      fs.mkdirSync(gamesDir, { recursive: true });
    }

    for (const item of allItems) {
      const itemSlug = item.slug || slugify(item.title || 'untitled');
      generateHTML('single', item, path.join(gamesDir, `${itemSlug}.html`));
    }

    // Generate paginated list pages
    if (config.pagination) {
      const itemsPerPage = config.pagination.itemsPerPage;
      const totalPages = Math.ceil(allItems.length / itemsPerPage);

      for (let page = 1; page <= totalPages; page++) {
        const pageItems = allItems.slice((page - 1) * itemsPerPage, page * itemsPerPage);
        const paginationHTML = getPaginationHTML(
          page,
          totalPages,
          'games',
          cleanPath
        );
        
        const outputPath = path.join(
          basePath,
          page === 1 ? 'games.html' : `games-page-${page}.html`
        );
        
        generateHTML('list', { items: pageItems }, outputPath, paginationHTML);
      }
    } else {
      generateHTML('list', { items: allItems }, path.join(basePath, 'games.html'));
    }

    // Process taxonomies
    await processTaxonomies(allItems, basePath);

    console.log('Site generation complete!');
  } catch (error) {
    console.error('Error generating site:', error);
  }
}

generateSite();
