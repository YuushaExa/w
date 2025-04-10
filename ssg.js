const fs = require('fs');
const path = require('path');
const https = require('https');

// Load configuration
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

// Validate templates
function loadTemplate(file) {
  const content = fs.readFileSync(file, 'utf8');
  if (!content.includes('function getPagePath')) {
    throw new Error(`Missing getPagePath() in ${file}`);
  }
  return content;
}

// Ensure output directory exists
if (!fs.existsSync(config.outputDir)) {
  fs.mkdirSync(config.outputDir, { recursive: true });
}

// Load templates with validation
const templates = {
  base: fs.readFileSync(path.join('themes', config.template, 'baseof.html'), 'utf8'),
  single: fs.readFileSync(path.join('themes', config.template, 'single.html'), 'utf8'),
  list: fs.readFileSync(path.join('themes', config.template, 'list.html'), 'utf8'),
  pagination: loadTemplate(path.join('themes', config.template, 'pagination.html'))
};

// Helper function to fetch JSON data
async function fetchData(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}`));
        }
      });
    }).on('error', reject);
  });
}

// Extract and validate path function
function getPathFunction() {
  const funcMatch = templates.pagination.match(/function getPagePath\(.*?\)\s*{([\s\S]*?)}/);
  if (!funcMatch) throw new Error('Invalid getPagePath() in pagination.html');
  
  try {
    return new Function('page', funcMatch[1]);
  } catch (e) {
    throw new Error('Failed to parse getPagePath() function');
  }
}

// Generate pagination HTML
function getPaginationHTML(currentPage, totalPages, getPagePath) {
  try {
    return new Function('currentPage', 'totalPages', 'getPagePath', `
      try {
        ${templates.pagination}
        return {
          html: document.body.innerHTML,
          path: getPagePath(currentPage)
        };
      } catch (e) {
        return { error: e.message };
      }
    `)(currentPage, totalPages, getPagePath);
  } catch (e) {
    throw new Error(`Template error: ${e.message}`);
  }
}

// Generate HTML with error handling
function generateHTML(templateName, data, outputPath, pagination = '') {
  try {
    const template = templates[templateName];
    const content = new Function('data', 'pagination', `
      try {
        return \`${template}\`;
      } catch (e) {
        console.error('Template error:', e);
        return '<div class="error">Template rendering failed</div>';
      }
    `)(data, pagination);

    const fullHTML = new Function('data', `
      try {
        return \`${templates.base}\`;
      } catch (e) {
        console.error('Base template error:', e);
        return '<html><body>Page generation failed</body></html>';
      }
    `)({ ...data, content });

    fs.writeFileSync(outputPath, fullHTML);
    console.log(`Generated: ${outputPath}`);
  } catch (e) {
    console.error(`Failed to generate ${outputPath}:`, e.message);
  }
}

// Main generation function
async function generateSite() {
  try {
    const allItems = [];
    
    // Load data with error handling
    for (const dataUrl of config.data) {
      try {
        const data = await fetchData(dataUrl);
        allItems.push(...(Array.isArray(data) ? data : [data]));
      } catch (e) {
        console.error(`Failed to load ${dataUrl}:`, e.message);
      }
    }

    // Generate individual pages
    allItems.forEach(item => {
      generateHTML('single', item, path.join(config.outputDir, `${item.id}.html`));
    });

    // Handle pagination
    if (config.pagination) {
      try {
        const getPagePath = getPathFunction();
        const itemsPerPage = config.pagination;
        const totalPages = Math.ceil(allItems.length / itemsPerPage);

        for (let page = 1; page <= totalPages; page++) {
          const pageItems = allItems.slice(
            (page - 1) * itemsPerPage,
            page * itemsPerPage
          );

          const result = getPaginationHTML(page, totalPages, getPagePath);
          if (result.error) throw new Error(result.error);

          generateHTML('list', 
            { items: pageItems },
            path.join(config.outputDir, result.path),
            result.html
          );
        }
      } catch (e) {
        console.error('Pagination error:', e.message);
      }
    } else {
      generateHTML('list', 
        { items: allItems },
        path.join(config.outputDir, 'index.html')
      );
    }

    console.log('Site generation completed');
  } catch (error) {
    console.error('Site generation failed:', error.message);
  }
}

// Run with error handling
generateSite().catch(e => console.error('Fatal error:', e));
