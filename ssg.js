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

// Generate pagination HTML
function getPaginationHTML(currentPage, totalPages, filenamePattern) {
  // Extract the path prefix if it exists
  let pathPrefix = '';
  if (filenamePattern.includes('/')) {
    pathPrefix = filenamePattern.split('/')[0] + '/';
    filenamePattern = filenamePattern.split('/')[1];
  }

  return new Function(
    'currentPage', 
    'totalPages',
    'filenamePattern',
    'pathPrefix',
    `return \`${templates.pagination}\``
  )(currentPage, totalPages, filenamePattern, pathPrefix);
}
// Generate HTML with template literals
function generateHTML(templateName, data, outputPath, pagination = '') {
  const template = templates[templateName];
  
  // Create a context object with data, pagination, and our helper functions
  const context = {
    ...data,
    pagination,
    slugify: (input) => slugify(input)  // Add slugify directly to the context
  };

  // Modified template evaluation to include our context
  const content = new Function(
    'data', 
    `with(data) { return \`${template}\` }`
  )(context);

  // Also make slugify available in the base template
  const fullHTML = new Function(
    'data', 
    `with(data) { return \`${templates.base}\` }`
  )({ ...context, content });

  fs.writeFileSync(outputPath, fullHTML);
  console.log(`Generated: ${outputPath}`);
}

// Process taxonomies with base path
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
        const filenamePattern = config.pagination.filenamePattern || 'page-*.html';

        for (let page = 1; page <= totalPages; page++) {
          const pageItems = items.slice((page - 1) * itemsPerPage, page * itemsPerPage);
          // Create a custom filename pattern that includes the term slug
          const termFilenamePattern = `${termSlug}/page-*.html`;
          const paginationHTML = getPaginationHTML(page, totalPages, termFilenamePattern);
          
          const outputPath = path.join(
            taxonomyDir,
            page === 1 ? `${termSlug}.html` : `${termSlug}/page-${page}.html`
          );
          
          // Ensure the term directory exists for paginated pages
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

    // Create output directory if it doesn't exist
    if (!fs.existsSync(config.outputDir)) {
      fs.mkdirSync(config.outputDir, { recursive: true });
    }

    // Create games directory if path is specified
    const basePath = config.path ? path.join(config.outputDir, slugify(config.path)) : config.outputDir;
    if (config.path && !fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true });
    }

    // Generate individual pages
    for (const item of allItems) {
      const itemSlug = item.slug || slugify(item.title || 'untitled');
      const itemPath = path.join(basePath, `${itemSlug}.html`);
      generateHTML('single', item, itemPath);
    }

    // Generate paginated list pages
    if (config.pagination) {
      const itemsPerPage = config.pagination.itemsPerPage;
      const totalPages = Math.ceil(allItems.length / itemsPerPage);
      const filenamePattern = config.pagination.filenamePattern || 'page-*.html';

      for (let page = 1; page <= totalPages; page++) {
        const pageItems = allItems.slice((page - 1) * itemsPerPage, page * itemsPerPage);
        
        // Customize the filename pattern based on whether we have a path
        let actualFilenamePattern = filenamePattern;
        let paginationPathPrefix = '';
        
        if (config.path) {
          paginationPathPrefix = `${slugify(config.path)}/`;
          actualFilenamePattern = `${slugify(config.path)}/${filenamePattern}`;
        }

        const paginationHTML = getPaginationHTML(page, totalPages, actualFilenamePattern);
        
        // Determine output path
        let outputPath;
        if (config.path) {
          if (page === 1) {
            // Main page goes to /games.html
            outputPath = path.join(config.outputDir, `${slugify(config.path)}.html`);
          } else {
            // Paginated pages go to /games/page-2.html, etc.
            outputPath = path.join(config.outputDir, `${slugify(config.path)}`, `page-${page}.html`);
          }
        } else {
          // No path config - use default behavior
          outputPath = page === 1 
            ? path.join(config.outputDir, 'index.html')
            : path.join(config.outputDir, `page-${page}.html`);
        }

        generateHTML('list', { items: pageItems }, outputPath, paginationHTML);
      }
    } else {
      // Non-paginated version
      const outputPath = config.path
        ? path.join(config.outputDir, `${slugify(config.path)}.html`)
        : path.join(config.outputDir, 'index.html');
      generateHTML('list', { items: allItems }, outputPath);
    }

    // Process taxonomies (they go in the games/ subdirectory)
    if (config.path) {
      await processTaxonomies(allItems, basePath);
    } else {
      await processTaxonomies(allItems, config.outputDir);
    }

    console.log('Site generation complete!');
  } catch (error) {
    console.error('Error generating site:', error);
  }
}

generateSite();
