const fs = require('fs');
const path = require('path');
const https = require('https');

// Enhanced slugify function with error handling
function slugify(input) {
  try {
    if (typeof input !== 'string') {
      input = String(input);
      if (input === 'undefined' || input === 'null') {
        throw new Error('Invalid input for slugification');
      }
    }
    
    return input
      .toLowerCase()
      .replace(/\s+/g, '-')           // Replace spaces with -
          .replace(/\*\*+/g, '')          // Remove asterisks
      .replace(/\-\-+/g, '-')         // Replace multiple - with single -
      .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
      .replace(/^-+/, '')             // Trim - from start of text
      .replace(/-+$/, '');            // Trim - from end of text
  } catch (error) {
    console.error('Slugify error:', error);
    return 'untitled';
  }
}

// Load config with error handling
let config;
try {
  const configFile = fs.readFileSync('config.json', 'utf8');
  config = JSON.parse(configFile);
  
  // Validate required config fields
  if (!config.outputDir) {
    throw new Error('outputDir is required in config.json');
  }
  if (!config.template) {
    throw new Error('template is required in config.json');
  }
  if (!config.data || !Array.isArray(config.data) || config.data.length === 0) {
    throw new Error('data array with at least one URL is required in config.json');
  }
} catch (error) {
  console.error('Error loading config:', error);
  process.exit(1);
}

// Ensure output directory exists
try {
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }
} catch (error) {
  console.error('Error creating output directory:', error);
  process.exit(1);
}

// Load templates with error handling
const templates = {};
try {
  const templateDir = path.join('themes', config.template);
  
  // Verify template directory exists
  if (!fs.existsSync(templateDir)) {
    throw new Error(`Template directory not found: ${templateDir}`);
  }
  
  // Load each template with existence check
  const loadTemplate = (name) => {
    const templatePath = path.join(templateDir, `${name}.html`);
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template file not found: ${templatePath}`);
    }
    return fs.readFileSync(templatePath, 'utf8');
  };
  
  templates.base = loadTemplate('baseof');
  templates.single = loadTemplate('single');
  templates.list = loadTemplate('list');
  templates.pagination = loadTemplate('pagination');
  
  // These templates are optional
  if (fs.existsSync(path.join(templateDir, 'taxonomy.html'))) {
    templates.taxonomy = loadTemplate('taxonomy');
  }
  if (fs.existsSync(path.join(templateDir, 'terms.html'))) {
    templates.terms = loadTemplate('terms');
  }
} catch (error) {
  console.error('Error loading templates:', error);
  process.exit(1);
}

// Enhanced fetchData helper with better error handling
async function fetchData(url) {
  return new Promise((resolve, reject) => {
    if (!url || typeof url !== 'string') {
      return reject(new Error('Invalid URL provided'));
    }
    
    const req = https.get(url, (res) => {
      // Check for successful status code
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP request failed with status ${res.statusCode}`));
      }
      
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (!Array.isArray(parsed) && typeof parsed !== 'object') {
            throw new Error('Data is not a valid JSON object or array');
          }
          resolve(parsed);
        } catch (parseError) {
          reject(new Error(`Failed to parse JSON from ${url}: ${parseError.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(new Error(`Request failed for ${url}: ${error.message}`));
    });
    
    // Set timeout to prevent hanging
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error(`Request timeout for ${url}`));
    });
  });
}

// Generate pagination HTML with error handling
function getPaginationHTML(currentPage, totalPages, filenamePattern) {
  try {
    if (!templates.pagination) {
      console.warn('Pagination template not found, skipping pagination');
      return '';
    }
    
    if (typeof currentPage !== 'number' || typeof totalPages !== 'number') {
      throw new Error('Invalid pagination parameters');
    }
    
    return new Function(
      'currentPage', 
      'totalPages',
      'filenamePattern',
      `return \`${templates.pagination}\``
    )(currentPage, totalPages, filenamePattern);
  } catch (error) {
    console.error('Error generating pagination:', error);
    return '';
  }
}

// Enhanced HTML generation with error handling
function generateHTML(templateName, data, outputPath, pagination = '') {
  try {
    if (!templates[templateName]) {
      throw new Error(`Template ${templateName} not found`);
    }
    
    const template = templates[templateName];
    
    // Create a context object with data, pagination, and our helper functions
    const context = {
      ...data,
      pagination,
      slugify: (input) => slugify(input)
    };

    // Modified template evaluation to include our context
    let content;
    try {
      content = new Function(
        'data', 
        `with(data) { return \`${template}\` }`
      )(context);
    } catch (templateError) {
      throw new Error(`Error processing ${templateName} template: ${templateError.message}`);
    }

    // Also make slugify available in the base template
    let fullHTML;
    try {
      fullHTML = new Function(
        'data', 
        `with(data) { return \`${templates.base}\` }`
      )({ ...context, content });
    } catch (baseError) {
      throw new Error(`Error processing base template: ${baseError.message}`);
    }

    // Ensure directory exists before writing
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, fullHTML);
    console.log(`Generated: ${outputPath}`);
  } catch (error) {
    console.error(`Error generating ${outputPath}:`, error);
    // Continue with next file instead of exiting
  }
}

// Process taxonomies with enhanced error handling
async function processTaxonomies(allItems, basePath) {
  if (!config.taxonomies || !Array.isArray(config.taxonomies)) return;

  for (const taxonomy of config.taxonomies) {
    try {
      const taxonomySlug = slugify(taxonomy);
      const taxonomyDir = path.join(basePath, taxonomySlug);
      
      if (!fs.existsSync(taxonomyDir)) {
        fs.mkdirSync(taxonomyDir, { recursive: true });
      }

      const termsMap = new Map();

      for (const item of allItems) {
        try {
          if (item[taxonomy] && Array.isArray(item[taxonomy])) {
            for (const term of item[taxonomy]) {
              try {
                const termName = term.name || term;
                const termSlug = slugify(termName);
                
                if (!termsMap.has(termSlug)) {
                  termsMap.set(termSlug, {
                    name: termName,
                    items: []
                  });
                }
                termsMap.get(termSlug).items.push(item);
              } catch (termError) {
                console.error(`Error processing term ${term} in item ${item.title || 'untitled'}:`, termError);
              }
            }
          }
        } catch (itemError) {
          console.error(`Error processing item for taxonomy ${taxonomy}:`, itemError);
        }
      }

      // Generate term pages
      for (const [termSlug, termData] of termsMap) {
        try {
          const { name, items } = termData;
          
          if (config.pagination) {
            const itemsPerPage = config.pagination.itemsPerPage || 10;
            const totalPages = Math.ceil(items.length / itemsPerPage);
            const filenamePattern = config.pagination.filenamePattern || 'page-*.html';

            for (let page = 1; page <= totalPages; page++) {
              const pageItems = items.slice((page - 1) * itemsPerPage, page * itemsPerPage);
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
              
              if (templates.taxonomy) {
                generateHTML('taxonomy', { 
                  items: pageItems, 
                  term: name,
                  taxonomy: taxonomy 
                }, outputPath, paginationHTML);
              }
            }
          } else if (templates.taxonomy) {
            generateHTML('taxonomy', { 
              items: items, 
              term: name,
              taxonomy: taxonomy 
            }, path.join(taxonomyDir, `${termSlug}.html`));
          }
        } catch (termPageError) {
          console.error(`Error generating term page for ${termData.name}:`, termPageError);
        }
      }

      // Generate terms list page if template exists
      if (templates.terms) {
        try {
          const termsList = Array.from(termsMap.entries()).map(([slug, termData]) => ({
            name: termData.name,
            slug: slug,
            count: termData.items.length
          }));

          generateHTML('terms', { 
            terms: termsList,
            taxonomy: taxonomy 
          }, path.join(taxonomyDir, 'index.html'));
        } catch (termsListError) {
          console.error(`Error generating terms list for ${taxonomy}:`, termsListError);
        }
      }
    } catch (taxonomyError) {
      console.error(`Error processing taxonomy ${taxonomy}:`, taxonomyError);
    }
  }
}

// Main generation function with comprehensive error handling
async function generateSite() {
  try {
    // Load data with error handling
    const allItems = [];
    for (const dataUrl of config.data) {
      try {
        console.log(`Fetching data from: ${dataUrl}`);
        const data = await fetchData(dataUrl);
        
        if (!data) {
          console.warn(`No data returned from ${dataUrl}`);
          continue;
        }
        
        const items = Array.isArray(data) ? data : [data];
        allItems.push(...items);
        console.log(`Loaded ${items.length} items from ${dataUrl}`);
      } catch (fetchError) {
        console.error(`Error fetching data from ${dataUrl}:`, fetchError);
        // Continue with next data source instead of exiting
      }
    }

    if (allItems.length === 0) {
      throw new Error('No valid data was loaded from any source');
    }

    // Create path directory if specified in config
    const basePath = config.path ? path.join(config.outputDir, slugify(config.path)) : config.outputDir;
    try {
      if (!fs.existsSync(basePath)) {
        fs.mkdirSync(basePath, { recursive: true });
      }
    } catch (pathError) {
      throw new Error(`Error creating base path ${basePath}: ${pathError.message}`);
    }

    // Generate individual pages
    for (const item of allItems) {
      try {
        const itemSlug = item.slug || slugify(item.title || 'untitled');
        generateHTML('single', item, path.join(basePath, `${itemSlug}.html`));
      } catch (itemError) {
        console.error(`Error processing item ${item.title || 'untitled'}:`, itemError);
      }
    }

    // Generate 404 page if template exists
    try {
      const notFoundTemplatePath = path.join('themes', config.template, '404.html');
      if (fs.existsSync(notFoundTemplatePath)) {
        const notFoundTemplate = fs.readFileSync(notFoundTemplatePath, 'utf8');
        fs.writeFileSync(path.join(config.outputDir, '404.html'), notFoundTemplate);
        console.log('Generated: 404.html');
      }
    } catch (notFoundError) {
      console.error('Error generating 404 page:', notFoundError);
    }
    
    // Generate paginated list pages
    try {
      if (config.pagination) {
        const itemsPerPage = config.pagination.itemsPerPage || 10;
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
    } catch (listError) {
      console.error('Error generating list pages:', listError);
    }

    // Process taxonomies if template exists
    if (templates.taxonomy) {
      await processTaxonomies(allItems, basePath);
    } else {
      console.log('Skipping taxonomies - taxonomy template not found');
    }

    console.log('Site generation complete!');
  } catch (error) {
    console.error('Fatal error generating site:', error);
    process.exit(1);
  }
}

generateSite();
