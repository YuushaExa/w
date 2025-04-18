const fs = require('fs');
const path = require('path');
const https = require('https');

// Basic slugify function
function slugify(input) {
  // Keep existing implementation
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

// --- URL Generation Helper ---
const siteBasePath = config.path ? `/${slugify(config.path)}` : '';

function generateUrl(logicalPath) {
  // Ensure leading slash and combine with site base path
  let fullPath = path.join(siteBasePath, logicalPath).replace(/\\/g, '/'); // Use forward slashes

  // Remove trailing 'index.html'
  if (fullPath.endsWith('/index.html')) {
    fullPath = fullPath.substring(0, fullPath.length - 'index.html'.length);
  }

  // Ensure trailing slash for directory-like paths (ending with / or was index.html)
  // But avoid double slash at the root
  if (!fullPath.endsWith('/') && !path.basename(fullPath).includes('.')) {
     if (fullPath !== '') { // Avoid adding trailing slash if it's just the base path root ""
         fullPath += '/';
     }
  }

   // Handle the absolute root case explicitly
   if (logicalPath === '/' || logicalPath === '/index.html') {
       return siteBasePath ? siteBasePath + '/' : '/';
   }
   // Ensure it starts with a slash if not empty
   if (fullPath && !fullPath.startsWith('/')) {
       fullPath = '/' + fullPath;
   }

  // Special case: if siteBasePath is empty and path is '/', return '/'
  if (!siteBasePath && fullPath === '') return '/';


  return fullPath || '/'; // Return '/' if path calculation results in empty string
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
  // Keep existing implementation
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

// Generate pagination HTML
// Now takes baseLinkPath and the generateUrl helper
function getPaginationHTML(currentPage, totalPages, baseLinkPath, filenamePattern) {
  // The pagination template itself needs to be adapted to use generateUrl correctly
  // We pass generateUrl and baseLinkPath into its execution context.
  // filenamePattern should now *not* include '.html' if it's for page > 1 links that should be clean
  // Example: filenamePattern could be 'page-*'
    
  // Modify the template execution to include generateUrl and baseLinkPath
  const paginationTemplateRunner = new Function(
      'currentPage',
      'totalPages',
      'baseLinkPath',
      'filenamePattern',
      'generateUrl', // Make helper available inside pagination template
      ` return \`${templates.pagination}\`;`
  );

  return paginationTemplateRunner(
      currentPage,
      totalPages,
      baseLinkPath, // e.g., "/", "/posts/", "/tags/news/"
      filenamePattern, // e.g., "page-*"
      generateUrl // Pass the helper function
  );
}


// Generate HTML with template literals
function generateHTML(templateName, data, outputPath, pagination = '') {
  const template = templates[templateName];

  // Create a context object with data, pagination, and our helper functions
  const context = {
    ...data,
    pagination,
    slugify: slugify, // Add slugify
    generateUrl: generateUrl // Add URL generator
  };

  // Evaluate the specific page template (list, single, etc.)
  const content = new Function(
    'data',
    `with(data) { return \`${template}\` }`
  )(context);

  // Evaluate the base template, passing the generated content and the context
  const fullHTML = new Function(
    'data',
    `with(data) { return \`${templates.base}\` }`
  )({ ...context, content }); // Ensure helpers are available in baseof.html too

  // Ensure directory exists before writing file
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, fullHTML);
  console.log(`Generated: ${outputPath}`);
}

// Process taxonomies with base path
async function processTaxonomies(allItems, contentBasePath) { // Renamed basePath to contentBasePath for clarity
  if (!config.taxonomies || !Array.isArray(config.taxonomies)) return;

  for (const taxonomy of config.taxonomies) {
    const taxonomySlug = slugify(taxonomy);
    // Physical directory path for output files
    const taxonomyOutputDir = path.join(contentBasePath, taxonomySlug);
     // Logical base path for URL generation within this taxonomy
    const taxonomyUrlBasePath = `/${taxonomySlug}/`;


    if (!fs.existsSync(taxonomyOutputDir)) {
      fs.mkdirSync(taxonomyOutputDir, { recursive: true });
    }

    const termsMap = new Map();

    // Collect terms and associated items
    for (const item of allItems) {
      if (item[taxonomy] && Array.isArray(item[taxonomy])) {
        for (const term of item[taxonomy]) {
          const termName = term.name || term; // Handle object or string terms
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

    // Generate term pages (listing items for a specific term)
    for (const [termSlug, termData] of termsMap) {
      const { name, items } = termData;
      // Logical base path for URLs related to this specific term
      const termUrlBasePath = `${taxonomyUrlBasePath}${termSlug}/`;
      // Physical output directory for this specific term's files
      const termOutputDir = path.join(taxonomyOutputDir, termSlug);

      if (config.pagination) {
        const itemsPerPage = config.pagination.itemsPerPage;
        const totalPages = Math.ceil(items.length / itemsPerPage);
        // Use a pattern like "page-*" (without .html) for generateUrl logic
        const filenamePattern = (config.pagination.filenamePattern || 'page-*').replace('.html', '');

        for (let page = 1; page <= totalPages; page++) {
          const pageItems = items.slice((page - 1) * itemsPerPage, page * itemsPerPage);
          // Generate pagination HTML using the term's base URL path
          const paginationHTML = getPaginationHTML(page, totalPages, termUrlBasePath, filenamePattern);

          // Determine the physical output path
          const outputPath = path.join(
            // Page 1 goes to termSlug/index.html
            // Other pages go to termSlug/page-N.html
            termOutputDir,
            page === 1 ? `index.html` : `${filenamePattern.replace('*', page)}.html`
          );

          // Ensure the term directory exists (needed for page > 1)
           if (!fs.existsSync(termOutputDir)) {
             fs.mkdirSync(termOutputDir, { recursive: true });
           }

          generateHTML('taxonomy', {
            items: pageItems,
            term: name,
            taxonomy: taxonomy,
            currentPage: page, // Pass current page info if needed in template
            totalPages: totalPages
          }, outputPath, paginationHTML);
        }
      } else {
        // No pagination: Generate single term page at termSlug/index.html
         const outputPath = path.join(termOutputDir, `index.html`);
         if (!fs.existsSync(termOutputDir)) {
             fs.mkdirSync(termOutputDir, { recursive: true });
         }
        generateHTML('taxonomy', {
          items: items,
          term: name,
          taxonomy: taxonomy
        }, outputPath);
      }
    }

    // Generate terms list page (listing all terms for the taxonomy)
    const termsList = Array.from(termsMap.entries()).map(([slug, termData]) => ({
      name: termData.name,
      slug: slug, // The slug for linking
      count: termData.items.length,
      // Provide the clean URL directly if needed in the template
      url: generateUrl(`${taxonomyUrlBasePath}${slug}/`)
    }));

    generateHTML('terms', {
      terms: termsList,
      taxonomy: taxonomy,
      taxonomySlug: taxonomySlug // Pass slug if needed
    }, path.join(taxonomyOutputDir, 'index.html')); // Output to taxonomySlug/index.html
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

    // Determine the physical base output directory based on config.path
    const outputBaseDir = config.path ? path.join(config.outputDir, slugify(config.path)) : config.outputDir;
    if (outputBaseDir !== config.outputDir && !fs.existsSync(outputBaseDir)) {
      fs.mkdirSync(outputBaseDir, { recursive: true });
    }
     // Logical base path for root-level content URLs
    const rootUrlBasePath = `/`; // URLs start from here relative to site root


    // Generate individual pages
    for (const item of allItems) {
        const itemSlug = item.slug || slugify(item.title || 'untitled');
        // Output path is still itemSlug.html within the base directory
        const outputPath = path.join(outputBaseDir, `${itemSlug}.html`);
        // Pass item data along with potential metadata
        generateHTML('single', { ...item, site: { baseUrl: siteBasePath } }, outputPath);
    }


    // Generate paginated list pages (e.g., home page, /page/2, etc.)
    if (config.pagination) {
      const itemsPerPage = config.pagination.itemsPerPage;
      const totalPages = Math.ceil(allItems.length / itemsPerPage);
      // Use a pattern like "page-*" for generateUrl logic
      const filenamePattern = (config.pagination.filenamePattern || 'page-*').replace('.html','');

      for (let page = 1; page <= totalPages; page++) {
        const pageItems = allItems.slice((page - 1) * itemsPerPage, page * itemsPerPage);
        // Generate pagination using the root base path
        const paginationHTML = getPaginationHTML(page, totalPages, rootUrlBasePath, filenamePattern);

        // Determine physical output path
        const outputPath = path.join(
          outputBaseDir,
          // Page 1 goes to index.html
          // Others go to page-N.html
          page === 1 ? 'index.html' : `${filenamePattern.replace('*', page)}.html`
        );
        generateHTML('list', {
             items: pageItems,
             currentPage: page,
             totalPages: totalPages,
             site: { baseUrl: siteBasePath }
            }, outputPath, paginationHTML);
      }
    } else {
      // No pagination: Generate single list page at index.html
      generateHTML('list', { items: allItems, site: { baseUrl: siteBasePath } }, path.join(outputBaseDir, 'index.html'));
    }

    // Process taxonomies, passing the physical output base directory
    await processTaxonomies(allItems, outputBaseDir);

    console.log('Site generation complete!');
  } catch (error) {
    console.error('Error generating site:', error);
  }
}

generateSite();
