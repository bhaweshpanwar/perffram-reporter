/*Main Program Flow
If initialPerformanceData is not available:
    - Show critical error
    - Stop execution
Cache essential DOM elements
Initialize application with initialPerformanceData:
    - Store data globally
    - Setup chart structure (SVG, axes, labels)
    - Populate filter controls (scale, branch, date)
    - Setup event listeners
    - Apply filters and render initial chart
    - Setup responsive handling for window resize*/

// Global variables
let allData = [];
let filteredData = [];
let currentFilters = {
  branches: [],
  scale: 0,
};

// DOM Elements
const DOMElements = {};

//Cache DOM Elements
//Essential things removed
// download, view mode, table, insights, fullscreen
function cacheDOMElements() {
  DOMElements.body = document.body;
  DOMElements.chooseScaleEl = document.getElementById('chooseScale');
  DOMElements.chooseBranchesEl = document.getElementById('chooseBranches');

  DOMElements.chartViewEl = document.getElementById('chartView');

  DOMElements.activeFiltersDisplayEl = document.getElementById(
    'activeFiltersDisplay'
  );

  DOMElements.chartContainerEl = document.getElementById('chartContainer');
  DOMElements.svgD3 = d3.select('#chart');
  DOMElements.tooltipD3 = d3.select('#tooltip');
  DOMElements.legendContainerD3 = d3.select('#legend');
  DOMElements.contextSvgD3 = d3.select('#contextChart');
}

document.addEventListener('DOMContentLoaded', () => {
  cacheDOMElements();

  // Replace API call with CSV file fetch
  fetch('./fireweed.csv')
    .then((response) => {
      if (!response.ok)
        throw new Error(
          `Failed to load CSV file: ${response.status} ${response.statusText}`
        );
      return response.text();
    })
    .then((csvText) => {
      // Parse CSV data
      const rawData = parseCSV(csvText);

      if (!rawData || !Array.isArray(rawData))
        throw new Error('Invalid data format in CSV file');
      if (rawData.length === 0) throw new Error('No data found in CSV file');

      // Process data and add missing fields with default values
      allData = rawData.map((d) => ({
        branch: d.branch,
        revision: d.revision,
        scale: +d.scale,
        ctime: new Date(d.ctime * 1000),
        metric: +d.metric,
        complete_at: new Date(d.complete_at * 1000),
      }));

      initializeApp();
    })
    .catch((error) => {
      console.error('Error fetching or processing data:', error);
      alert(
        'Critical error: Unable to load performance data. Please check the console for details.'
      );
    });
});

// Simple CSV parser function
function parseCSV(csvText) {
  const lines = csvText.split('\n');
  const headers = lines[0].split(',').map((h) => h.trim());

  return lines.slice(1).map((line) => {
    const values = line.split(',');
    const entry = {};
    headers.forEach((header, i) => {
      entry[header] = values[i] ? values[i].trim() : '';
    });
    return entry;
  });
}

// Initialize the application with initial performance data
function initializeApp() {
  setupChartStructure();
  setupBrushChart();
  populateFilterControls(); // This will set initial currentFilters
  setupEventListeners();
  applyFiltersAndRenderAll();
  setupResponsiveHandling(); // Now setup resize
  console.log('Application initialized with performance data.');
}

// D3 Chart Gloabal Object
// const chartGlobals = {
//   margin: { top: 50, right: 40, bottom: 60, left: 70 },
//   width: 0,
//   height: 0,
//   x: d3.scaleTime(),
//   y: d3.scaleLinear(),
//   color: d3.scaleOrdinal(d3.schemeTableau10),
//   lineGenerator: null,
//   mainGroup: null,
//   xAxisG: null,
//   yAxisG: null,
//   xAxisGridG: null,
//   yAxisGridG: null,
// };

const chartGlobals = {
  margin: { top: 20, right: 20, bottom: 120, left: 60 }, // Increased bottom margin for focus chart
  heightContext: 80, // Height of the context chart area
  marginContext: { top: 20, right: 20, bottom: 30, left: 60 }, // Margins FOR the context chart, relative to its own drawing area

  // Focus chart scales
  x: d3.scaleTime(),
  y: d3.scaleLinear(),

  // Context chart scales
  xContext: d3.scaleTime(),
  yContext: d3.scaleLinear(),

  color: d3.scaleOrdinal(d3.schemeTableau10),
  lineGenerator: null, // This will be for the focus chart

  // Focus chart groups
  mainGroup: null,
  xAxisG: null,
  yAxisG: null,
  xAxisGridG: null,
  yAxisGridG: null,

  // Context chart groups
  contextMainGroup: null,
  contextXAxisG: null,
  // No y-axis usually needed for context, or a very simple one

  brush: null, // To store the d3.brush() instance

  width: 0, // Drawing width (container - margins) for BOTH focus and context
  height: 0, // Drawing height for FOCUS chart (container height - focus margins - context height area)
};

// const chartGlobalsContext = {
//   margin: { top: 20, right: 20, bottom: 100, left: 60 },
//   marginContext: { top: 30, right: 20, bottom: 30, left: 60 },
//   heightContext: 80,
//   xContext: d3.scaleTime(),
//   yContext: d3.scaleLinear(),
//   contextMainGroup: null,
//   contextXAxisG: null,
// };

function setupChartStructure() {
  //create main group
  chartGlobals.mainGroup = DOMElements.svgD3
    .append('g')
    .attr(
      'transform',
      `translate(${chartGlobals.margin.left}, ${chartGlobals.margin.top})`
    );

  //adding axes and grid groups
  chartGlobals.xAxisGridG = chartGlobals.mainGroup
    .append('g')
    .attr('class', 'x-grid grid');

  chartGlobals.yAxisGridG = chartGlobals.mainGroup
    .append('g')
    .attr('class', 'y-grid grid');

  chartGlobals.xAxisG = chartGlobals.mainGroup
    .append('g')
    .attr('class', 'x-axis axis');
  chartGlobals.yAxisG = chartGlobals.mainGroup
    .append('g')
    .attr('class', 'y-axis axis');

  //adding axis labels
  DOMElements.svgD3
    .append('text')
    .attr('class', 'axis-label x-label')
    .style('text-anchor', 'middle')
    .text('Commit Date');

  DOMElements.svgD3
    .append('text')
    .attr('class', 'axis-label y-label')
    .attr('transform', 'rotate(-90)') // Just rotate it
    .style('text-anchor', 'middle')
    .text('Performance Metric');

  //creating a line generator
  chartGlobals.lineGenerator = d3
    .line()
    .x((d) => chartGlobals.x(d.ctime))
    .y((d) => chartGlobals.y(d.metric));
}

// ---- Filter Controls ----

function getUniqueValues(data, key) {
  return [...new Set(data.map((item) => item[key]).filter(Boolean))].sort();
}

function populateFilterControls() {
  //only for scale and branches
  const uniqueBranches = getUniqueValues(allData, 'branch');
  const uniqueScales = getUniqueValues(allData, 'scale');

  // Populate branches dropdown
  populateDropdown(
    DOMElements.chooseBranchesEl,
    uniqueBranches,
    'Select Branch'
  );
  // Populate scale dropdown
  populateDropdown(DOMElements.chooseScaleEl, uniqueScales, 'Select Scale');

  // Setting initial filter values in currentFilters
  if (uniqueScales.length > 0) {
    currentFilters.scale = uniqueScales[0]; // Default to the first available scale
    DOMElements.chooseScaleEl.value = currentFilters.scale;
  } else {
    currentFilters.scale = 0; // Or some other default if no scales
  }

  currentFilters.branches = [...uniqueBranches];
  Array.from(DOMElements.chooseBranchesEl.options).forEach((opt) => {
    if (currentFilters.branches.includes(opt.value)) {
      opt.selected = true;
    }
  });

  // Set initial full date range for the brush context and potentially focus chart
  const fullDateExtent = d3.extent(allData, (d) => d.ctime);
  if (fullDateExtent[0] && fullDateExtent[1]) {
    currentFilters.dateRange = fullDateExtent; // Focus chart shows all initially
    // The brush will also use this full extent for its xContext scale
  } else {
    currentFilters.dateRange = [new Date(), new Date()]; // Fallback
  }
}

function populateDropdown(selectElement, optionsArray, defaultOptionText) {
  selectElement.innerHTML = '';
  if (defaultOptionText) {
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = defaultOptionText;
    selectElement.appendChild(defaultOpt);
  }
  optionsArray.forEach((optValue) => {
    const option = document.createElement('option');
    option.value = optValue;
    option.textContent = optValue;
    selectElement.appendChild(option);
  });
}

function setupEventListeners() {
  // Scale change
  DOMElements.chooseScaleEl.addEventListener('change', (e) => {
    currentFilters.scale = +e.target.value || 0;
    applyFiltersAndRenderAll();
  });

  // Branches change
  DOMElements.chooseBranchesEl.addEventListener('change', (e) => {
    const selectedBranches = Array.from(e.target.selectedOptions).map(
      (opt) => opt.value
    );
    currentFilters.branches = selectedBranches;
    applyFiltersAndRenderAll();
  });
}

function applyFiltersAndRenderAll() {
  filteredData = allData.filter((d) => {
    const dateFromFilter = currentFilters.dateRange
      ? currentFilters.dateRange[0]
      : null;
    const dateToFilter = currentFilters.dateRange
      ? currentFilters.dateRange[1]
      : null;
    const isInDateRange =
      (!dateFromFilter || d.ctime >= dateFromFilter) &&
      (!dateToFilter || d.ctime <= dateToFilter);
    const isInScale =
      currentFilters.scale === 0 || d.scale === currentFilters.scale;
    const isInBranch =
      currentFilters.branches.length === 0 ||
      currentFilters.branches.includes(d.branch);
    return isInDateRange && isInScale && isInBranch;
  });
  updateActiveFiltersDisplay();
  updateChartUI(filteredData);
  updateContextChart(filteredData);
}

function updateActiveFiltersDisplay() {
  const { branches, scale } = currentFilters;
  const displayParts = [];
  if (branches.length > 0) {
    displayParts.push(`Branches: ${branches.join(', ')}`);
  } else {
    displayParts.push('Branches: All');
  }
  // if (dateRange[0] && dateRange[1]) {
  //   displayParts.push(
  //     `Date Range: ${dateRange[0].toLocaleDateString()} - ${dateRange[1].toLocaleDateString()}`
  //   );
  // }
  if (scale > 0) {
    displayParts.push(`Scale: ${scale}`);
  }
  DOMElements.activeFiltersDisplayEl.textContent = displayParts.join(' | ');
}

// --- CHART DRAWING AND UPDATES ---

function setupBrushChart() {
  const { svgD3, contextSvgD3 } = DOMElements;
  const { margin, marginContext, heightContext, height, width } = chartGlobals;

  const contextChartYPosition =
    height + margin.bottom - heightContext - marginContext.bottom;

  // Ensure a translate function exists
  function translate(x, y) {
    return `translate(${x},${y})`;
  }

  chartGlobals.contextMainGroup = svgD3
    .append('g')
    .attr('class', 'context')
    .attr('transform', translate(marginContext.left, contextChartYPosition));

  chartGlobals.contextXAxisG = chartGlobals.contextMainGroup
    .append('g')
    .attr('class', 'x-axis context-axis')
    .attr('transform', translate(0, heightContext));

  chartGlobals.brush = d3
    .brushX()
    .extent([
      [0, 0],
      [width, heightContext],
    ])
    .on('brush end', brushed);

  chartGlobals.contextMainGroup
    .append('g')
    .attr('class', 'brush')
    .call(chartGlobals.brush);
}

function updateChartUI(dataToDraw) {
  const {
    x,
    y,
    color,
    lineGenerator,
    margin,
    mainGroup, // FIX 1: Use mainGroup
    xAxisG,
    yAxisG,
    xAxisGridG,
    yAxisGridG,
  } = chartGlobals;
  const { svgD3 } = DOMElements;

  if (!dataToDraw || dataToDraw.length === 0) {
    mainGroup.selectAll('*').remove();
    xAxisG.selectAll('*').remove();
    yAxisG.selectAll('*').remove();
    xAxisGridG.selectAll('*').remove();
    yAxisGridG.selectAll('*').remove();

    mainGroup
      .append('text')
      .attr('class', 'no-data-message')
      .attr('x', chartGlobals.width / 2)
      .attr('y', chartGlobals.height / 2)
      .attr('text-anchor', 'middle')
      .style('font-size', '16px')
      .text('No data available for the selected filters.');
    updateLegend([]);
    return;
  }
  mainGroup.select('.no-data-message').remove();

  // --- THIS IS THE CRUCIAL CHANGE FOR THE X-AXIS DOMAIN ---
  if (
    currentFilters.dateRange &&
    currentFilters.dateRange[0] &&
    currentFilters.dateRange[1]
  ) {
    x.domain(currentFilters.dateRange); // Set X domain from the brush selection
  } else {
    // Fallback if brush isn't active or range is invalid: show all data passed to this function
    const xExtentFallback = d3.extent(dataToDraw, (d) => d.ctime);
    x.domain(xExtentFallback || [new Date(), new Date()]); // Default to extent of current data or today
    console.warn(
      'Focus chart using fallback x-domain as currentFilters.dateRange is not set.'
    );
  }
  // x.range([0, chartGlobals.width]);

  const xExtent = d3.extent(dataToDraw, (d) => d.ctime);
  const yMinOriginal = d3.min(dataToDraw, (d) => d.metric);
  const yMaxOriginal = d3.max(dataToDraw, (d) => d.metric);

  let yPadding = (yMaxOriginal - yMinOriginal) * 0.1;
  if (yPadding === 0 && yMaxOriginal === yMinOriginal)
    yPadding = yMaxOriginal === 0 ? 1 : Math.abs(yMaxOriginal * 0.1);
  if (yPadding === 0 && yMaxOriginal !== yMinOriginal) yPadding = 0.1; // for case when min or max is 0

  const yDomainMin = yMinOriginal - yPadding; // This will make it start from min data point minus padding
  const yDomainMax = yMaxOriginal + yPadding;

  x.domain(xExtent).range([0, chartGlobals.width]);
  y.domain([yDomainMin, yDomainMax]).nice().range([chartGlobals.height, 0]);

  const dateFormat = d3.timeFormat('%d-%b-%y');

  // FIX 4: More robust tick generation for X-axis
  let xAxisCall = d3.axisBottom(x).tickFormat(dateFormat);
  const timeSpanDays =
    x.domain()[1] && x.domain()[0]
      ? (x.domain()[1] - x.domain()[0]) / (1000 * 60 * 60 * 24)
      : 0;
  const numTicksTarget = Math.min(
    10,
    Math.max(5, Math.floor(chartGlobals.width / 100))
  );
  xAxisCall.ticks(numTicksTarget);

  xAxisG
    .attr('transform', `translate(0,${chartGlobals.height})`)
    .transition()
    .duration(300)
    .call(xAxisCall);

  yAxisG
    .transition()
    .duration(300)
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(',')));

  // Adjust grid lines based on the actual ticks generated by axes
  const xTickValues = xAxisG
    .selectAll('.tick')
    .data()
    .map((d) => (d instanceof Date ? d : new Date(d)));
  const yTickValues = yAxisG.selectAll('.tick').data();

  xAxisGridG
    .attr('transform', `translate(0,${chartGlobals.height})`)
    .transition()
    .duration(300)
    .call(
      d3
        .axisBottom(x)
        .tickValues(xTickValues)
        .tickSize(-chartGlobals.height)
        .tickFormat('')
    );
  yAxisGridG
    .transition()
    .duration(300)
    .call(
      d3
        .axisLeft(y)
        .tickValues(yTickValues)
        .tickSize(-chartGlobals.width)
        .tickFormat('')
    );

  // FIX 1: Correct positioning for axis labels (children of svgD3)
  svgD3
    .select('.axis-label.x-label')
    .attr(
      'transform',
      `translate(${margin.left + chartGlobals.width / 2}, ${
        margin.top + chartGlobals.height + margin.bottom - 20
      })`
    );
  svgD3
    .select('.axis-label.y-label') // Already rotated -90 in setupChart
    .attr('y', margin.left / 2 - 15)
    .attr('x', 0 - (margin.top + chartGlobals.height / 2));

  const dataByBranch = d3.group(dataToDraw, (d) => d.branch);
  // FIX 1: Select series from mainGroup
  const series = mainGroup
    .selectAll('.data-series-group')
    .data(Array.from(dataByBranch), ([branch]) => branch);

  series.exit().transition().duration(300).style('opacity', 0).remove();
  const seriesEnter = series
    .enter()
    .append('g')
    .attr('class', 'data-series-group');

  seriesEnter
    .append('path')
    .attr('class', 'line')
    .style('fill', 'none')
    .style('stroke-width', 1.5);

  series
    .merge(seriesEnter)
    .select('.line')
    .transition()
    .duration(300)
    .attr('d', ([, values]) =>
      lineGenerator(values.sort((a, b) => a.ctime - b.ctime))
    )
    .style('stroke', ([branch]) => color(branch));

  // FIX 1: Select points from mainGroup
  const allPoints = mainGroup
    .selectAll('.point')
    .data(dataToDraw, (d) => `${d.branch}-${d.revision}-${d.ctime.getTime()}`);

  allPoints.exit().transition().duration(300).attr('r', 0).remove();

  allPoints
    .enter()
    .append('circle')
    .attr('class', 'point')
    .attr('r', 0)
    .on('mouseover', showTooltip)
    .on('mouseout', hideTooltip)
    .merge(allPoints)
    .style('fill', (d) => color(d.branch)) // FIX 3: Set fill on merged selection
    .transition()
    .duration(300)
    .attr('cx', (d) => x(d.ctime))
    .attr('cy', (d) => y(d.metric))
    .attr('r', 2);

  updateLegend(Array.from(dataByBranch.keys()));
}

function brushed(event) {
  if (event.sourceEvent && event.sourceEvent.type === 'zoom') return; // ignore brush-by-zoom
  if (!event.selection) {
    // If brush is cleared
    // Optionally reset to full range or do nothing
    // currentFilters.dateRange = d3.extent(allData, d => d.ctime);
    // Or maybe you want to keep the last valid selection if brush is cleared by clicking outside
    // For now, let's assume if selection is null, we don't update the focus chart
    // or you could set currentFilters.dateRange to null and handle that in applyFilters
    return;
  }
  const [x0, x1] = event.selection.map(chartGlobals.xContext.invert); // Convert pixel coords to dates
  currentFilters.dateRange = [x0, x1];

  // Update the focus chart's X domain
  chartGlobals.x.domain(currentFilters.dateRange);
  // DOMElements.focusChartXAxisG.call(d3.axisBottom(chartGlobals.x)); // Update focus X axis (assuming focusChartXAxisG is cached)
  // You would actually re-call parts of updateChartUI or applyFiltersAndRenderAll
  const dateFormat = d3.timeFormat('%d-%b-%y');
  let xAxisCallFocus = d3.axisBottom(chartGlobals.x).tickFormat(dateFormat);
  const numTicksTargetFocus = Math.min(
    10,
    Math.max(5, Math.floor(chartGlobals.width / 100))
  );
  xAxisCallFocus.ticks(numTicksTargetFocus);

  chartGlobals.xAxisG // Use the correct reference
    .attr('transform', `translate(0,${chartGlobals.height})`) // Ensure it's positioned correctly
    .transition() // Optional: for smooth update
    .duration(event.sourceEvent ? 50 : 0) // Faster if it's a direct brush event
    .call(xAxisCallFocus);
  // Re-filter and re-render the FOCUS chart
  // This part might be tricky. You only want to update the focus chart's X-domain and re-render its content
  // without re-filtering *all* data if only the date range changed.
  // Simplest is to call applyFiltersAndRenderAll, but it will re-filter everything.
  // For better performance, update focus chart's x domain and then redraw its lines/points.

  // Let's call applyFiltersAndRenderAll for simplicity in POC, it will re-filter
  // and then updateChartUI will use the new currentFilters.dateRange
  applyFiltersAndRenderAll();
}

function updateContextChart(dataFilteredByScaleAndBranch) {
  const {
    xContext,
    yContext,
    color,
    lineGenerator,
    marginContext,
    heightContext,
    contextMainGroup,
    contextXAxisG,
  } = chartGlobals;
  if (
    !dataFilteredByScaleAndBranch ||
    dataFilteredByScaleAndBranch.length === 0
  ) {
    contextMainGroup.selectAll('*').remove();
    return;
  }

  // Set scales for context chart
  xContext
    .domain(d3.extent(dataFilteredByScaleAndBranch, (d) => d.ctime))
    .range([0, chartGlobals.width]); // Uses main chart's width for context x-axis
  yContext
    .domain(d3.extent(dataFilteredByScaleAndBranch, (d) => d.metric))
    .range([heightContext, 0]);

  // Draw X axis for context chart
  contextXAxisG.call(
    d3.axisBottom(xContext).ticks(Math.floor(chartGlobals.width / 100))
  );

  const dataByBranchContext = d3.group(
    dataFilteredByScaleAndBranch,
    (d) => d.branch
  );

  const contextSeries = contextMainGroup
    .selectAll('.context-series-group')
    .data(Array.from(dataByBranchContext), ([branch]) => branch);

  contextSeries.exit().remove();

  const contextSeriesEnter = contextSeries
    .enter()
    .append('g')
    .attr('class', 'context-series-group');

  contextSeriesEnter
    .append('path')
    .attr('class', 'line context-line')
    .style('fill', 'none')
    .style('stroke-width', 1); // Thinner lines for context

  contextSeries
    .merge(contextSeriesEnter)
    .select('.line.context-line')
    .attr('d', ([, values]) =>
      // Use a line generator specific to context scales or adapt main one
      d3
        .line()
        .x((d) => xContext(d.ctime))
        .y((d) => yContext(d.metric))(values.sort((a, b) => a.ctime - b.ctime))
    )
    .style('stroke', ([branch]) => color(branch));

  // Update brush extent if necessary (usually done once in setupBrushChart)
  // chartGlobals.brush.extent([[0, 0], [chartGlobals.width, heightContext]]);
  // contextMainGroup.select(".brush").call(chartGlobals.brush);
  // Optionally, set initial brush position if not already done
  if (
    !d3.brushSelection(chartGlobals.contextMainGroup.select('.brush').node())
  ) {
    chartGlobals.contextMainGroup
      .select('.brush')
      .call(chartGlobals.brush.move, chartGlobals.xContext.range());
  }
  // At the end of updateContextChart
  if (
    chartGlobals.contextMainGroup &&
    chartGlobals.contextMainGroup.select('.brush').node() &&
    !d3.brushSelection(chartGlobals.contextMainGroup.select('.brush').node())
  ) {
    chartGlobals.contextMainGroup
      .select('.brush')
      .call(chartGlobals.brush.move, chartGlobals.xContext.range());
  }
}

function applyFiltersAndRenderAll() {
  // ... (filtering logic for scale and branch to get 'filteredDataForContext') ...
  let filteredDataForContext = allData.filter((d) => {
    const isInScale =
      currentFilters.scale === 0 || d.scale === currentFilters.scale;
    const isInBranch =
      currentFilters.branches.length === 0 ||
      currentFilters.branches.includes(d.branch);
    return isInScale && isInBranch;
  });

  // Now filter this further for the FOCUS chart based on dateRange
  let filteredDataForFocus = filteredDataForContext.filter((d) => {
    const dateFromFilter = currentFilters.dateRange
      ? currentFilters.dateRange[0]
      : null;
    const dateToFilter = currentFilters.dateRange
      ? currentFilters.dateRange[1]
      : null;
    const isInDateRange =
      (!dateFromFilter || d.ctime >= dateFromFilter) &&
      (!dateToFilter || d.ctime <= dateToFilter);
    return isInDateRange;
  });

  updateActiveFiltersDisplay();
  updateChartUI(filteredDataForFocus); // Update focus chart
  updateContextChart(filteredDataForContext); // Update context chart
}

function updateLegend(activeBranchesOnChart) {
  // activeBranchesOnChart is the list of branches currently being plotted
  DOMElements.legendContainerD3.selectAll('.legend-item').remove();

  // Get all unique branches from the initially loaded dataset for this test/system
  const allPossibleBranchesInView = getUniqueValues(allData, 'branch'); // Use allData here

  // If you want the legend to only show branches that *could* appear with current filters
  // (e.g., if a scale filter removes all data for a certain branch),
  // you might filter 'allData' by currentFilters.scale and currentFilters.dateRange
  // before getting unique branches. However, for a legend, showing all *possible* branches
  // from the initial load is usually better, and their active state is determined by currentFilters.branches.

  allPossibleBranchesInView.forEach((branch) => {
    // Iterate over all possible branches
    const isSelectedInFilter = currentFilters.branches.includes(branch); // Check if it's selected
    // const isOnChart = activeBranchesOnChart.includes(branch); // This tells you if it's currently plotted

    DOMElements.legendContainerD3
      .append('div')
      // The 'inactive' class should be based on whether the branch is in currentFilters.branches
      .attr('class', `legend-item ${isSelectedInFilter ? '' : 'inactive'}`)
      .attr('data-branch', branch)
      .html(
        `<span class="legend-color" style="background-color:${chartGlobals.color(
          branch
        )};"></span> ${branch}`
      )
      .on('click', function () {
        const clickedBranch = d3.select(this).attr('data-branch');
        const index = currentFilters.branches.indexOf(clickedBranch);

        if (index > -1) {
          // Branch is currently selected, try to deselect
          if (currentFilters.branches.length > 1) {
            // Only deselect if more than one is selected
            currentFilters.branches.splice(index, 1);
          } else {
            console.log('At least one branch must remain selected.');
            // Optionally, re-select it visually if you prevent deselection
            // d3.select(this).classed('inactive', false); // This would be if you toggled class directly
            return; // Don't proceed to re-render
          }
        } else {
          // Branch is not selected, select it
          currentFilters.branches.push(clickedBranch);
        }

        currentFilters.branches.sort();
        // No need to call populateBranchSelector or renderBranchPills if they are removed
        applyFiltersAndRenderAll(); // Correct: re-filter and re-render everything
      });
  });
}

function showTooltip(event, d) {
  const { tooltipD3 } = DOMElements; // svgD3 no longer needed directly here for pointer
  tooltipD3.style('pointer-events', 'auto');

  const formattedDate = d.ctime.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const shortHash = d.revision.substring(0, 7);
  const commitLink = `https://github.com/postgres/postgres/commit/${d.revision}`;

  tooltipD3.transition().duration(100).style('opacity', 0.95);
  tooltipD3.html(`
              <div class="tooltip-date">${formattedDate}</div>
              <div class="version-item">
                  <span class="version-color" style="background-color:${chartGlobals.color(
                    d.branch
                  )}"></span>
                  <span class="version-name">${d.branch}</span>
                  <span class="version-value">${d3.format(',.1f')(
                    d.metric
                  )}</span>
              </div>
              <div class="commit-details">
                  <strong>Commit Hash:</strong> ${shortHash}<br>
                  <strong>Commit Message:</strong> <span class="commit-message">${
                    d.commit_message || 'N/A'
                  }</span>
                  <a href="${commitLink}" target="_blank" rel="noopener noreferrer">View Full Commit Details</a>
              </div>`);

  // FIX 1: Tooltip positioning uses mainGroup as reference for pointer coords
  const [mouseXlocal, mouseYlocal] = d3.pointer(
    event,
    chartGlobals.mainGroup.node()
  );

  const mainGroupRect = chartGlobals.mainGroup.node().getBoundingClientRect();
  const bodyRect = document.body.getBoundingClientRect();

  let left =
    mainGroupRect.left - bodyRect.left + mouseXlocal + 15 + window.scrollX;
  let top =
    mainGroupRect.top - bodyRect.top + mouseYlocal - 15 + window.scrollY; // Initial top, adjust if it makes tooltip go off screen

  const tooltipNode = tooltipD3.node();
  const tooltipHeight = tooltipNode.offsetHeight;
  const tooltipWidth = tooltipNode.offsetWidth;

  // Adjust top position if tooltip goes above viewport due to its height
  if (mainGroupRect.top - bodyRect.top + mouseYlocal - tooltipHeight - 15 < 0) {
    top = mainGroupRect.top - bodyRect.top + mouseYlocal + 15 + window.scrollY;
  } else {
    top =
      mainGroupRect.top -
      bodyRect.top +
      mouseYlocal -
      tooltipHeight -
      15 +
      window.scrollY;
  }

  if (left + tooltipWidth > window.innerWidth + window.scrollX - 10) {
    left =
      mainGroupRect.left -
      bodyRect.left +
      mouseXlocal -
      15 -
      tooltipWidth +
      window.scrollX;
  }
  if (top < window.scrollY + 10) {
    top = window.scrollY + 10;
  }
  if (top + tooltipHeight > window.innerHeight + window.scrollY - 10) {
    top = window.innerHeight + window.scrollY - tooltipHeight - 10;
  }
  if (left < window.scrollX + 10) {
    left = window.scrollX + 10;
  }

  tooltipD3.style('left', `${left}px`).style('top', `${top}px`);
  d3.select(event.currentTarget)
    .transition()
    .duration(50)
    .attr('r', 4)
    .style('stroke', '#333')
    .style('stroke-width', 1.5);
}

function hideTooltip(event) {
  DOMElements.tooltipD3
    .transition()
    .duration(200)
    .style('opacity', 0)
    .on('end', function () {
      d3.select(this).style('pointer-events', 'none');
    });
  d3.select(event.currentTarget)
    .transition()
    .duration(100)
    .attr('r', 2)
    .style('stroke', 'none');
}

function setupResponsiveHandling() {
  window.addEventListener('resize', handleResize);
}

function handleResize() {
  if (
    !DOMElements.chartContainerEl /*|| DOMElements.chartViewEl.classList.contains('hidden') - if you re-add view modes*/
  ) {
    return;
  }

  const newContainerWidth = DOMElements.chartContainerEl.clientWidth;
  // Keep a reasonable aspect ratio, or fixed height for POC
  const newSvgHeight = Math.max(300, Math.min(500, newContainerWidth * 0.55));

  chartGlobals.width =
    newContainerWidth - chartGlobals.margin.left - chartGlobals.margin.right;
  chartGlobals.height =
    newSvgHeight - chartGlobals.margin.top - chartGlobals.margin.bottom;

  chartGlobals.width = Math.max(0, chartGlobals.width); // Ensure not negative
  chartGlobals.height = Math.max(0, chartGlobals.height);

  DOMElements.svgD3
    .attr('width', newContainerWidth)
    .attr('height', newSvgHeight);

  if (chartGlobals.width > 0 && chartGlobals.height > 0 && allData.length > 0) {
    applyFiltersAndRenderAll(); // This will re-calculate scales and redraw
  } else if (allData.length > 0) {
    chartGlobals.mainGroup.selectAll('*').remove();
    chartGlobals.mainGroup
      .append('text')
      .attr('x', chartGlobals.width / 2)
      .attr('y', chartGlobals.height / 2)
      .attr('text-anchor', 'middle')
      .text('Chart area too small.');
  }
}
