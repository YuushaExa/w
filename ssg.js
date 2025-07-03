const fs = require('fs');
const path = require('path');
const https = require('https');

// Basic slugify function
function slugify(input, existingSlugs = new Set()) {
  // Convert to string and basic cleanup
  let slug = String(input)
    .toLowerCase()
    .normalize('NFKD') // Normalize Unicode
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(/[^\w\-]+/g, '') // Remove non-word chars
    .replace(/\-\-+/g, '-') // Replace multiple - with single -
    .replace(/^-+/, '') // Trim - from start
    .replace(/-+$/, ''); // Trim - from end

  // Handle empty result
  if (!slug) slug = 'untitled';

  // Enforce minimum length of 2
  if (slug.length < 2) {
    slug = slug.padEnd(2, '0');
  }

  // Enforce maximum length of 30
  if (slug.length > 30) {
    slug = slug.substring(0, 30);
    // Don't end with a hyphen
    if (slug.endsWith('-')) {
      slug = slug.substring(0, 29);
    }
  }

  // Handle uniqueness
  let finalSlug = slug;
  let counter = 1;
  
  while (existingSlugs.has(finalSlug)) {
    counter++;
    // Append counter without exceeding length limit
    const suffix = `-${counter}`;
    const base = slug.substring(0, 30 - suffix.length);
    // Don't end with a hyphen before adding counter
    if (base.endsWith('-')) {
      finalSlug = base.substring(0, base.length - 1) + suffix;
    } else {
      finalSlug = base + suffix;
    }
  }

  // Add to existing slugs if set was provided
  if (existingSlugs instanceof Set) {
    existingSlugs.add(finalSlug);
  }

  return finalSlug;
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
}

// Process taxonomies with base path
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
    let loggedTaxonomyPages = 0; // Counter for logged taxonomy pages

    for (const item of allItems) {
      if (item[taxonomy] && Array.isArray(item[taxonomy])) {
        const itemSlug = item.slug || slugify(item.title || 'untitled');
        const itemWithPrettyUrl = {
          ...item,
          url: `/${path.join(slugify(config.path || ''), itemSlug)}/`
        };

        for (const term of item[taxonomy]) {
          const termName = term.name || term;
          const termSlug = slugify(termName);
          
          if (!termsMap.has(termSlug)) {
            termsMap.set(termSlug, {
              name: termName,
              items: []
            });
          }
          termsMap.get(termSlug).items.push(itemWithPrettyUrl);
        }
      }
    }

    // Generate term pages
    for (const [termSlug, termData] of termsMap) {
      const { name, items } = termData;
      
      if (config.pagination) {
        const itemsPerPage = config.pagination.itemsPerPage;
        const totalPages = Math.ceil(items.length / itemsPerPage);
        const filenamePattern = config.pagination.filenamePattern || 'page-*/index.html';

        for (let page = 1; page <= totalPages; page++) {
          const pageItems = items.slice((page - 1) * itemsPerPage, page * itemsPerPage);
          const termFilenamePattern = `${termSlug}/page-*/index.html`;
          const paginationHTML = getPaginationHTML(page, totalPages, termFilenamePattern);
          
          const outputPath = path.join(
            taxonomyDir,
            page === 1 ? `${termSlug}/index.html` : `${termSlug}/page-${page}/index.html`
          );
          
          if (!fs.existsSync(path.dirname(outputPath))) {
            fs.mkdirSync(path.dirname(outputPath), { recursive: true });
          }
          
          generateHTML('taxonomy', { 
            items: pageItems, 
            term: name,
            taxonomy: taxonomy 
          }, outputPath, paginationHTML);

          // Only log first 3 taxonomy pages
          if (loggedTaxonomyPages < 3) {
            console.log(`Generated taxonomy page: ${outputPath}`);
            loggedTaxonomyPages++;
          }
        }
      } else {
        const outputPath = path.join(taxonomyDir, `${termSlug}/index.html`);
        if (!fs.existsSync(path.dirname(outputPath))) {
          fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        }
        
        generateHTML('taxonomy', { 
          items: items, 
          term: name,
          taxonomy: taxonomy 
        }, outputPath);

        // Only log first 3 taxonomy pages
        if (loggedTaxonomyPages < 3) {
          console.log(`Generated taxonomy page: ${outputPath}`);
          loggedTaxonomyPages++;
        }
      }
    }

    // Show summary if there are more taxonomy pages
    const totalTaxonomyPages = Array.from(termsMap.values()).reduce((total, termData) => {
      return total + (config.pagination ? Math.ceil(termData.items.length / config.pagination.itemsPerPage) : 1);
    }, 0);
    
    if (totalTaxonomyPages > 3) {
      console.log(`...and ${totalTaxonomyPages - 3} more taxonomy pages for ${taxonomy}`);
    }

    // Generate terms list page
    const termsList = Array.from(termsMap.entries()).map(([slug, termData]) => ({
      name: termData.name,
      slug: slug,
      count: termData.items.length,
      url: `/${path.join(slugify(config.path || ''), taxonomySlug, slug)}/`
    }));

    generateHTML('terms', { 
      terms: termsList,
      taxonomy: taxonomy 
    }, path.join(taxonomyDir, 'index.html'));
    
    console.log(`Generated taxonomy index: ${path.join(taxonomyDir, 'index.html')}`);
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

    // Generate individual pages
let pageCount = 0;
for (const item of allItems) {
  const itemSlug = item.slug || slugify(item.title || 'untitled');
  const itemDir = path.join(basePath, itemSlug); // e.g., output/w/super-mario

  // Ensure the directory for the item exists
  if (!fs.existsSync(itemDir)) {
    fs.mkdirSync(itemDir, { recursive: true });
  }

  const outputPath = path.join(itemDir, 'index.html'); // e.g., output/w/super-mario/index.html
  generateHTML('single', item, outputPath);
  
  // Only log the first 3 pages
  if (pageCount < 3) {
    console.log(`Generated: ${outputPath}`);
    pageCount++;
  }
}

if (allItems.length > 3) {
  console.log(`...and ${allItems.length - 3} more single pages`);
}

const notFoundTemplatePath = path.join('themes', config.template, '404.html');
if (fs.existsSync(notFoundTemplatePath)) {
    const notFoundTemplate = fs.readFileSync(notFoundTemplatePath, 'utf8');
    fs.writeFileSync(path.join(config.outputDir, '404.html'), notFoundTemplate);
    console.log('Generated: 404.html');
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
      generateHTML('list', { items: allItems }, path.join(basePath, 'index.html'));
    }

    // Process taxonomies
    await processTaxonomies(allItems, basePath);

    console.log('Site generation complete!');
  } catch (error) {
    console.error('Error generating site:', error);
  }
}

generateSite();
