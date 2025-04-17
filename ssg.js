const fs = require('fs');
const path = require('path');
const https = require('https');

// Basic slugify function
function slugify(input) {
  return String(input)
    .toLowerCase()
    .replace(/\s+/g, '-')           // Replace spaces with -
    .replace(/\-\-+/g, '-')         // Replace multiple - with single -
    .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
    .replace(/^-+/, '')             // Trim - from start of text
    .replace(/-+$/, '');            // Trim - from end of text
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

// Generate pagination HTML with clean URLs
function getPaginationHTML(currentPage, totalPages, filenamePattern) {
  // Remove .html from the pattern
  const cleanPattern = filenamePattern.replace('.html', '').replace('*.', '');
  return new Function(
    'currentPage', 
    'totalPages',
    'filenamePattern',
    `return \`${templates.pagination.replace(/\.html/g, '')}\``
  )(currentPage, totalPages, cleanPattern);
}

// Generate HTML with clean URLs (using directories with index.html)
function generateHTML(templateName, data, outputPath, pagination = '') {
  const template = templates[templateName];
  
  const context = {
    ...data,
    pagination,
    slugify: (input) => slugify(input)
  };

  const content = new Function(
    'data', 
    `with(data) { return \`${template}\` }`
  )(context);

  const fullHTML = new Function(
    'data', 
    `with(data) { return \`${templates.base}\` }`
  )({ ...context, content });

  // Create directory structure with index.html
  const dirPath = outputPath.replace(/\.html$/, '');
  const finalPath = path.join(dirPath, 'index.html');
  
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  
  fs.writeFileSync(finalPath, fullHTML);
  console.log(`Generated: ${finalPath}`);
}

// Process taxonomies with clean URLs
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

    // Generate term pages with clean URLs
    for (const [termSlug, termData] of termsMap) {
      const { name, items } = termData;
      
      if (config.pagination) {
        const itemsPerPage = config.pagination.itemsPerPage;
        const totalPages = Math.ceil(items.length / itemsPerPage);
        const filenamePattern = config.pagination.filenamePattern || 'page-*';

        for (let page = 1; page <= totalPages; page++) {
          const pageItems = items.slice((page - 1) * itemsPerPage, page * itemsPerPage);
          const paginationHTML = getPaginationHTML(page, totalPages, filenamePattern);
          
          const outputPath = path.join(
            taxonomyDir,
            page === 1 ? termSlug : `${termSlug}/page-${page}`
          );
          
          if (page > 1 && !fs.existsSync(path.join(taxonomyDir, termSlug))) {
            fs.mkdirSync(path.join(taxonomyDir, termSlug), { recursive: true });
          }
          
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
        }, path.join(taxonomyDir, termSlug));
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
    }, path.join(taxonomyDir, ''));
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
    const basePath = config.path ? path.join(config.outputDir, slugify(config.path)) : config.outputDir;
    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true });
    }

    // Generate individual pages with clean URLs
    for (const item of allItems) {
      const itemSlug = item.slug || slugify(item.title || 'untitled');
      generateHTML('single', item, path.join(basePath, itemSlug));
    }

    // Generate paginated list pages with clean URLs
    if (config.pagination) {
      const itemsPerPage = config.pagination.itemsPerPage;
      const totalPages = Math.ceil(allItems.length / itemsPerPage);
      const filenamePattern = config.pagination.filenamePattern || 'page-*';

      for (let page = 1; page <= totalPages; page++) {
        const pageItems = allItems.slice((page - 1) * itemsPerPage, page * itemsPerPage);
        const paginationHTML = getPaginationHTML(page, totalPages, filenamePattern);
        const outputPath = path.join(
          basePath,
          page === 1 ? '' : filenamePattern.replace('*', page)
        );
        generateHTML('list', { items: pageItems }, outputPath, paginationHTML);
      }
    } else {
      generateHTML('list', { items: allItems }, path.join(basePath, ''));
    }

    // Process taxonomies with clean URLs
    await processTaxonomies(allItems, basePath);

    // Create a .nojekyll file for GitHub Pages
    fs.writeFileSync(path.join(config.outputDir, '.nojekyll'), '');
    
    console.log('Site generation complete with clean URLs!');
  } catch (error) {
    console.error('Error generating site:', error);
  }
}

generateSite();
