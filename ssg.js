const fs = require('fs');
const path = require('path');
const https = require('https');

// Load configuration
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
  pagination: fs.readFileSync(path.join('themes', config.template, 'pagination.html'), 'utf8') || '<div class="pagination">${pagination}</div>'
};

// Helper function to fetch JSON data
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
function generatePagination(currentPage, totalPages) {
  let paginationHTML = '<div class="pagination">';
  
  if (currentPage > 1) {
    paginationHTML += `<a href="${currentPage === 2 ? 'index.html' : `page${currentPage - 1}.html`}" class="prev">Previous</a> `;
  }

  for (let i = 1; i <= totalPages; i++) {
    if (i === currentPage) {
      paginationHTML += `<span class="current">${i}</span> `;
    } else {
      paginationHTML += `<a href="${i === 1 ? 'index.html' : `page${i}.html`}">${i}</a> `;
    }
  }

  if (currentPage < totalPages) {
    paginationHTML += `<a href="page${currentPage + 1}.html" class="next">Next</a>`;
  }

  paginationHTML += '</div>';
  return paginationHTML;
}

// Generate HTML by evaluating template literals
function generateHTML(templateName, data, outputPath, pagination = '') {
  const template = templates[templateName];
  
  // Evaluate template literals (${...})
  const content = new Function('data', 'pagination', `return \`${template}\``)(data, pagination);
  
  // If it's not the base template, wrap it in the base layout
  const fullHTML = templateName === 'base' 
    ? content 
    : new Function('data', `return \`${templates.base}\``)({ ...data, content });
  
  fs.writeFileSync(outputPath, fullHTML);
  console.log(`Generated: ${outputPath}`);
}

// Main generation function
async function generateSite() {
  try {
    // Load all data sources
    const allItems = [];
    
    for (const dataUrl of config.data) {
      const data = await fetchData(dataUrl);
      if (Array.isArray(data)) {
        allItems.push(...data);
      } else {
        allItems.push(data);
      }
    }
    
    // Generate individual pages
    for (const item of allItems) {
      const outputPath = path.join(config.outputDir, `${item.id}.html`);
      generateHTML('single', item, outputPath);
    }
    
    // Generate paginated list pages if pagination is enabled
    if (config.pagination) {
      const itemsPerPage = config.pagination;
      const totalPages = Math.ceil(allItems.length / itemsPerPage);
      
      for (let page = 1; page <= totalPages; page++) {
        const startIdx = (page - 1) * itemsPerPage;
        const endIdx = startIdx + itemsPerPage;
        const pageItems = allItems.slice(startIdx, endIdx);
        
        const paginationHTML = generatePagination(page, totalPages);
        const outputPath = path.join(
          config.outputDir, 
          page === 1 ? 'index.html' : `page${page}.html`
        );
        
        generateHTML('list', { items: pageItems }, outputPath, paginationHTML);
      }
    } else {
      // Generate single list page if no pagination
      const listOutputPath = path.join(config.outputDir, 'index.html');
      generateHTML('list', { items: allItems }, listOutputPath);
    }
    
    console.log('Site generation complete!');
  } catch (error) {
    console.error('Error generating site:', error);
  }
}

// Run the generator
generateSite();
