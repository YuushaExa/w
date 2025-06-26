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
  console.log(`Generated: ${outputPath}`);
}

// Process taxonomies with base path
async function processTaxonomies(allItems, basePath) {
  if (!config.taxonomies || !Array.isArray(config.taxonomies)) return;

  for (const taxonomy of config.taxonomies) {
    const taxonomySlug = slugify(taxonomy);
    const taxonomyDir = path.join(basePath, taxonomySlug); // e.g., output/w/games
    
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
      // ADDED: Define the specific directory for this term
      const termDir = path.join(taxonomyDir, termSlug); // e.g., output/w/games/action
      
      // ADDED: Ensure this new term directory exists
      if (!fs.existsSync(termDir)) {
        fs.mkdirSync(termDir, { recursive: true });
      }

      if (config.pagination) {
        const itemsPerPage = config.pagination.itemsPerPage;
        const totalPages = Math.ceil(items.length / itemsPerPage);
        // CHANGED: The filename pattern is now relative to the term's directory
        const filenamePattern = config.pagination.filenamePattern || 'page-*.html';

        for (let page = 1; page <= totalPages; page++) {
          const pageItems = items.slice((page - 1) * itemsPerPage, page * itemsPerPage);
          // Pass the simpler pattern. The template will build relative links.
          const paginationHTML = getPaginationHTML(page, totalPages, filenamePattern);
          
          // CHANGED: The output path logic is now simpler and uses the 'index.html' trick
          const outputPath = path.join(
            termDir,
            page === 1 ? 'index.html' : filenamePattern.replace('*', page)
          );
          
          // The old directory creation logic for pagination is no longer needed, 
          // as we create the main `termDir` above.
          
          generateHTML('taxonomy', { 
            items: pageItems, 
            term: name,
            taxonomy: taxonomy 
          }, outputPath, paginationHTML);
        }
      } else {
        // CHANGED: Create the term page as 'index.html' inside its own folder
        const outputPath = path.join(termDir, 'index.html');
        generateHTML('taxonomy', { 
          items: items, 
          term: name,
          taxonomy: taxonomy 
        }, outputPath);
      }
    }

    // Generate terms list page (This part was already correct)
    const termsList = Array.from(termsMap.entries()).map(([slug, termData]) => ({
      name: termData.name,
      slug: slug, // The slug will correctly link to the new directory, e.g., "action"
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

    // Create path directory if specified in config
    const basePath = config.path ? path.join(config.outputDir, slugify(config.path)) : config.outputDir;
    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true });
    }

    // Generate individual pages
      for (const item of allItems) {
      const itemSlug = item.slug || slugify(item.title || 'untitled');
      const itemDir = path.join(basePath, itemSlug); // e.g., output/w/super-mario

      // Ensure the directory for the item exists
      if (!fs.existsSync(itemDir)) {
        fs.mkdirSync(itemDir, { recursive: true });
      }

      const outputPath = path.join(itemDir, 'index.html'); // e.g., output/w/super-mario/index.html
      generateHTML('single', item, outputPath);
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
