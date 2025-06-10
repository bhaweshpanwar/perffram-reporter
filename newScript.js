let allData = [];
let filteredDataForFocus = []; // Renamed for clarity
let filteredDataForContext = []; // For the context chart (only filtered by scale/branch)

let currentFilters = {
  branches: [],
  scale: 0,
  dateRange: null, // Will be [Date, Date] array from brush
};

const DOMElements = {};

function cacheDOMElements() {
  DOMElements.body = document.body;
  DOMElements.chooseScaleEl = document.getElementById('chooseScale');
  DOMElements.chooseBranchesEl = document.getElementById('chooseBranches');
  DOMElements.activeFiltersDisplayEl = document.getElementById(
    'activeFiltersDisplay'
  );
  DOMElements.chartContainerEl = document.getElementById('chartContainer');
  DOMElements.svgD3 = d3.select('#chart');
  DOMElements.tooltipD3 = d3.select('#tooltip');
  DOMElements.legendContainerD3 = d3.select('#legend');
  // No DOMElements.contextSvgD3 if context is a <g> in main SVG
}

document.addEventListener('DOMContentLoaded', () => {
  cacheDOMElements();
  fetch('./fireweed.csv')
    .then((response) => {
      if (!response.ok) throw new Error(`CSV load error: ${response.status}`);
      return response.text();
    })
    .then((csvText) => {
      const rawData = parseCSV(csvText);
      if (!rawData || !Array.isArray(rawData) || rawData.length === 0)
        throw new Error('Invalid or empty CSV data');
      allData = rawData.map((d) => ({
        branch: d.branch,
        revision: d.revision,
        scale: +d.scale,
        ctime: new Date(d.ctime * 1000),
        metric: +d.metric,
        commit_message: `Commit ${
          d.revision ? d.revision.substring(0, 7) : 'N/A'
        }`, // Added for tooltip
      }));
      initializeApp();
    })
    .catch((error) => {
      console.error('Data Load Error:', error);
      alert('Critical error loading data. See console.');
    });
});

function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines
    .slice(1)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const values = line.split(',');
      const entry = {};
      headers.forEach((header, i) => {
        entry[header] = values[i] ? values[i].trim() : '';
      });
      return entry;
    });
}

const chartGlobals = {
  margin: { top: 20, right: 20, bottom: 110, left: 60 }, // Increased bottom for context
  heightContext: 70,
  marginContext: { top: 10, right: 0, bottom: 20, left: 0 }, // Relative to context group

  x: d3.scaleTime(),
  y: d3.scaleLinear(),
  xContext: d3.scaleTime(),
  yContext: d3.scaleLinear(),
  color: d3.scaleOrdinal(d3.schemeTableau10),
  lineGenerator: null,

  mainGroup: null,
  xAxisG: null,
  yAxisG: null,
  xAxisGridG: null,
  yAxisGridG: null,
  contextMainGroup: null,
  contextXAxisG: null,
  brush: null,
  width: 0,
  height: 0, // For focus chart drawing area
  tooltipHideTimeout: null,
};

function initializeApp() {
  setupChartStructure();
  setupBrushAndContextChartStructure();
  populateFilterControls();
  setupEventListeners();
  setupResponsiveHandling(); // Call handleResize once to set initial dimensions & render
  console.log('App initialized.');
}

function setupChartStructure() {
  chartGlobals.mainGroup = DOMElements.svgD3
    .append('g')
    .attr('class', 'focus')
    .attr(
      'transform',
      `translate(${chartGlobals.margin.left},${chartGlobals.margin.top})`
    );

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

  DOMElements.svgD3
    .append('text')
    .attr('class', 'axis-label x-label')
    .style('text-anchor', 'middle')
    .text('Commit Date');
  DOMElements.svgD3
    .append('text')
    .attr('class', 'axis-label y-label')
    .attr('transform', 'rotate(-90)')
    .style('text-anchor', 'middle')
    .text('Performance Metric');

  chartGlobals.lineGenerator = d3
    .line()
    .x((d) => chartGlobals.x(d.ctime))
    .y((d) => chartGlobals.y(d.metric));
}

function setupBrushAndContextChartStructure() {
  const { svgD3 } = DOMElements;
  const { marginContext, heightContext } = chartGlobals;

  chartGlobals.contextMainGroup = svgD3.append('g').attr('class', 'context');

  chartGlobals.contextXAxisG = chartGlobals.contextMainGroup
    .append('g')
    .attr('class', 'x-axis context-axis')
    .attr('transform', `translate(0,${heightContext})`);

  chartGlobals.brush = d3.brushX().on('brush end', brushed);

  chartGlobals.contextMainGroup
    .append('g')
    .attr('class', 'brush')
    .call(chartGlobals.brush);
}

function getUniqueValues(data, key) {
  return [...new Set(data.map((item) => item[key]).filter(Boolean))].sort(
    (a, b) => String(a).localeCompare(String(b))
  );
}

function populateFilterControls() {
  const uniqueBranches = getUniqueValues(allData, 'branch');
  const uniqueScales = getUniqueValues(allData, 'scale')
    .map((s) => +s)
    .sort((a, b) => a - b);

  populateDropdown(
    DOMElements.chooseBranchesEl,
    uniqueBranches,
    'All Branches'
  );
  populateDropdown(DOMElements.chooseScaleEl, uniqueScales, 'All Scales');

  if (uniqueScales.length > 0) {
    currentFilters.scale = uniqueScales[0];
    DOMElements.chooseScaleEl.value = currentFilters.scale;
  } else {
    currentFilters.scale = 0;
  }

  currentFilters.branches = []; // Default to no branches selected, or [...uniqueBranches] for all
  // If using multi-select dropdown:
  // Array.from(DOMElements.chooseBranchesEl.options).forEach(opt => {
  //   opt.selected = currentFilters.branches.includes(opt.value);
  // });

  const fullDateExtent = d3.extent(allData, (d) => d.ctime);
  currentFilters.dateRange =
    fullDateExtent[0] && fullDateExtent[1]
      ? fullDateExtent
      : [new Date(), new Date()];
}

function populateDropdown(selectElement, optionsArray, defaultOptionText) {
  selectElement.innerHTML = '';
  const defaultOpt = document.createElement('option');
  defaultOpt.value =
    defaultOptionText === 'All Scales' || defaultOptionText === 'All Branches'
      ? '0'
      : ''; // Use 0 for "All"
  defaultOpt.textContent = defaultOptionText;
  selectElement.appendChild(defaultOpt);

  optionsArray.forEach((optValue) => {
    const option = document.createElement('option');
    option.value = optValue;
    option.textContent = optValue;
    selectElement.appendChild(option);
  });
}

function setupEventListeners() {
  DOMElements.chooseScaleEl.addEventListener('change', (e) => {
    currentFilters.scale = +e.target.value || 0;
    applyFiltersAndRenderAll();
  });

  DOMElements.chooseBranchesEl.addEventListener('change', (e) => {
    if (e.target.value === '0' || e.target.value === '') {
      // "All Branches" or placeholder
      currentFilters.branches = []; // Empty array means all (or handle as per your filter logic)
    } else {
      currentFilters.branches = [e.target.value]; // Assuming single select for now for simplicity
      // For multi-select:
      // currentFilters.branches = Array.from(e.target.selectedOptions).map(opt => opt.value).filter(v => v && v !== "0");
    }
    applyFiltersAndRenderAll();
  });
}

function applyFiltersAndRenderAll() {
  filteredDataForContext = allData.filter((d) => {
    const isInScale =
      currentFilters.scale === 0 || d.scale === currentFilters.scale;
    const isInBranch =
      currentFilters.branches.length === 0 ||
      currentFilters.branches.includes(d.branch);
    return isInScale && isInBranch;
  });

  filteredDataForFocus = filteredDataForContext.filter((d) => {
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
  updateChartUI(filteredDataForFocus);
  updateContextChart(filteredDataForContext);
}

function updateActiveFiltersDisplay() {
  const { branches, scale, dateRange } = currentFilters;
  const displayParts = [];

  displayParts.push(`Scale: ${scale === 0 ? 'All' : scale}`);
  displayParts.push(
    `Branches: ${branches.length === 0 ? 'All' : branches.join(', ')}`
  );

  if (dateRange && dateRange[0] && dateRange[1]) {
    const fullDataExtent = d3.extent(allData, (d) => d.ctime);
    const isFullRange =
      fullDataExtent &&
      dateRange[0].getTime() === fullDataExtent[0].getTime() &&
      dateRange[1].getTime() === fullDataExtent[1].getTime();
    if (!isFullRange) {
      displayParts.push(
        `Dates: ${dateRange[0].toLocaleDateString()} - ${dateRange[1].toLocaleDateString()}`
      );
    } else {
      displayParts.push('Dates: All');
    }
  } else {
    displayParts.push('Dates: All');
  }
  DOMElements.activeFiltersDisplayEl.textContent = `Active Filters: ${displayParts.join(
    ' | '
  )}`;
}

function brushed(event) {
  if (event.sourceEvent && event.sourceEvent.type === 'zoom') return; // ignore brush-by-zoom
  if (!event.selection) {
    // If brush is cleared, show full range in focus
    const fullDataExtent = d3.extent(filteredDataForContext, (d) => d.ctime); // Use context data extent
    currentFilters.dateRange =
      fullDataExtent[0] && fullDataExtent[1]
        ? fullDataExtent
        : chartGlobals.xContext.domain();
  } else {
    currentFilters.dateRange = event.selection.map(
      chartGlobals.xContext.invert
    );
  }
  applyFiltersAndRenderAll(); // Re-render focus chart with new date range
}

function updateChartUI(dataToDraw) {
  const {
    x,
    y,
    color,
    lineGenerator,
    margin,
    mainGroup,
    xAxisG,
    yAxisG,
    xAxisGridG,
    yAxisGridG,
  } = chartGlobals;
  const { svgD3 } = DOMElements;

  if (!dataToDraw || dataToDraw.length === 0) {
    mainGroup.selectAll('*').remove(); // Clear previous content
    mainGroup
      .append('text')
      .attr('class', 'no-data-message')
      .attr('x', chartGlobals.width / 2)
      .attr('y', chartGlobals.height / 2)
      .attr('text-anchor', 'middle')
      .style('font-size', '16px')
      .text('No data for selected filters.');
    updateLegend([]);
    return;
  }
  mainGroup.select('.no-data-message').remove();

  if (
    currentFilters.dateRange &&
    currentFilters.dateRange[0] &&
    currentFilters.dateRange[1]
  ) {
    x.domain(currentFilters.dateRange);
  } else {
    x.domain(d3.extent(dataToDraw, (d) => d.ctime) || [new Date(), new Date()]);
  }
  x.range([0, chartGlobals.width]);

  const yMetrics = dataToDraw.map((d) => d.metric);
  const yMinOriginal = d3.min(yMetrics);
  const yMaxOriginal = d3.max(yMetrics);

  let yPadding = 0;
  if (yMinOriginal !== undefined && yMaxOriginal !== undefined) {
    yPadding = (yMaxOriginal - yMinOriginal) * 0.1;
    if (yPadding === 0)
      yPadding = yMaxOriginal === 0 ? 0.1 : Math.abs(yMaxOriginal * 0.1) || 0.1;
  } else {
    // Handle empty or single point data for y-domain
    y.domain([0, 1]); // Default domain
  }

  const yDomainMin = (yMinOriginal !== undefined ? yMinOriginal : 0) - yPadding;
  const yDomainMax = (yMaxOriginal !== undefined ? yMaxOriginal : 1) + yPadding;
  y.domain([yDomainMin, yDomainMax]).nice().range([chartGlobals.height, 0]);

  const dateFormat = d3.timeFormat('%d-%b-%y');
  let xAxisCall = d3.axisBottom(x).tickFormat(dateFormat);
  const numTicksTargetX = Math.min(
    10,
    Math.max(3, Math.floor(chartGlobals.width / 80))
  );
  xAxisCall.ticks(numTicksTargetX);

  xAxisG
    .attr('transform', `translate(0,${chartGlobals.height})`)
    .transition()
    .duration(0)
    .call(xAxisCall);
  yAxisG
    .transition()
    .duration(0)
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(',')));

  const xTickValues = xAxisG.selectAll('.tick').data();
  const yTickValues = yAxisG.selectAll('.tick').data();

  xAxisGridG
    .attr('transform', `translate(0,${chartGlobals.height})`)
    .transition()
    .duration(0)
    .call(
      d3
        .axisBottom(x)
        .tickValues(xTickValues)
        .tickSize(-chartGlobals.height)
        .tickFormat('')
    );
  yAxisGridG
    .transition()
    .duration(0)
    .call(
      d3
        .axisLeft(y)
        .tickValues(yTickValues)
        .tickSize(-chartGlobals.width)
        .tickFormat('')
    );

  svgD3
    .select('.axis-label.x-label')
    .attr(
      'transform',
      `translate(${margin.left + chartGlobals.width / 2}, ${
        margin.top + chartGlobals.height + margin.bottom - 20
      })`
    );
  svgD3
    .select('.axis-label.y-label')
    .attr('y', margin.left / 2 - 20)
    .attr('x', 0 - (margin.top + chartGlobals.height / 2));

  const dataByBranch = d3.group(dataToDraw, (d) => d.branch);
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

  const allPoints = mainGroup
    .selectAll('.point')
    .data(dataToDraw, (d) => `${d.branch}-${d.revision}-${d.ctime.getTime()}`);
  allPoints.exit().transition().duration(300).attr('r', 0).remove();
  allPoints
    .enter()
    .append('circle')
    .attr('class', 'point')
    .attr('r', 0) // Initial radius for enter transition
    .on('mouseover', showTooltip)
    .on('mouseout', hideTooltip)
    .merge(allPoints)
    .style('fill', (d) => color(d.branch))
    .transition()
    .duration(300)
    .attr('cx', (d) => x(d.ctime))
    .attr('cy', (d) => y(d.metric))
    .attr('r', 2.5);

  updateLegend(Array.from(dataByBranch.keys()));
}

function updateContextChart(dataForContext) {
  const {
    xContext,
    yContext,
    color,
    marginContext,
    heightContext,
    contextMainGroup,
    contextXAxisG,
    brush,
    width,
  } = chartGlobals;

  if (!dataForContext || dataForContext.length === 0) {
    contextMainGroup.selectAll('*').remove();
    if (brush && contextMainGroup.select('.brush').node()) {
      // Re-append brush if cleared
      contextMainGroup.append('g').attr('class', 'brush').call(brush);
    }
    return;
  }

  xContext.domain(d3.extent(dataForContext, (d) => d.ctime)).range([0, width]);
  yContext
    .domain(d3.extent(dataForContext, (d) => d.metric))
    .range([heightContext, 0]);

  contextXAxisG.call(
    d3
      .axisBottom(xContext)
      .ticks(Math.max(2, Math.floor(width / 100)))
      .tickFormat(d3.timeFormat('%b %y'))
  );

  const dataByBranchContext = d3.group(dataForContext, (d) => d.branch);
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
    .style('stroke-width', 1);

  contextSeries
    .merge(contextSeriesEnter)
    .select('.line.context-line')
    .attr('d', ([, values]) =>
      d3
        .line()
        .x((d) => xContext(d.ctime))
        .y((d) => yContext(d.metric))(values.sort((a, b) => a.ctime - b.ctime))
    )
    .style('stroke', ([branch]) => color(branch));

  // Ensure brush is present and set initial selection if none
  const brushGroup = contextMainGroup.select('.brush');
  if (brushGroup.empty()) {
    // If brush group was removed (e.g. by selectAll("*").remove())
    contextMainGroup.append('g').attr('class', 'brush').call(brush);
  }
  if (brush && !d3.brushSelection(brushGroup.node())) {
    brushGroup.call(brush.move, xContext.range());
  }
}

function updateLegend(activeBranchesOnChart) {
  DOMElements.legendContainerD3.selectAll('.legend-item').remove();
  const allPossibleBranchesInView = getUniqueValues(allData, 'branch');

  allPossibleBranchesInView.forEach((branch) => {
    const isSelectedInFilter =
      currentFilters.branches.length === 0 ||
      currentFilters.branches.includes(branch);
    DOMElements.legendContainerD3
      .append('div')
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

        // If "All Branches" (empty array) is active, clicking a branch selects only that one
        if (currentFilters.branches.length === 0) {
          currentFilters.branches = [clickedBranch];
        } else if (index > -1) {
          // Branch is selected
          if (currentFilters.branches.length > 1) {
            // If more than one, deselect it
            currentFilters.branches.splice(index, 1);
          } else {
            // If only one, clicking it means show all
            currentFilters.branches = []; // Empty array for "All Branches"
          }
        } else {
          // Branch is not selected, add it
          currentFilters.branches.push(clickedBranch);
        }
        currentFilters.branches.sort();
        applyFiltersAndRenderAll();
      });
  });
}

chartGlobals.tooltipHideTimeout = null;
function showTooltip(event, d) {
  if (chartGlobals.tooltipHideTimeout) {
    clearTimeout(chartGlobals.tooltipHideTimeout);
    chartGlobals.tooltipHideTimeout = null;
  }
  const { tooltipD3 } = DOMElements;
  tooltipD3.style('pointer-events', 'auto');

  const formattedDate = d.ctime.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const shortHash = d.revision ? d.revision.substring(0, 7) : 'N/A';
  const commitMessage = d.commit_message || 'N/A'; // Use the processed commit_message
  const commitLink = d.revision
    ? `https://github.com/postgres/postgres/commit/${d.revision}`
    : '#';

  tooltipD3.html(`
    <div class="tooltip-date">${formattedDate}</div>
    <div class="version-item">
      <span class="version-color" style="background-color:${chartGlobals.color(
        d.branch
      )}"></span>
      <span class="version-name">${d.branch}</span>
      <span class="version-value">${d3.format(',.1f')(d.metric)}</span>
    </div>
    <div class="commit-details">
      <strong>Commit Hash:</strong> ${shortHash}<br>
      <strong>Message:</strong> <span class="commit-message">${commitMessage}</span>
      ${
        d.revision
          ? `<a href="${commitLink}" target="_blank" rel="noopener noreferrer">View Commit Details</a>`
          : ''
      }
    </div>
  `);

  tooltipD3.transition().duration(100).style('opacity', 0.95);

  const [mouseXlocal, mouseYlocal] = d3.pointer(
    event,
    chartGlobals.mainGroup.node()
  );
  const mainGroupRect = chartGlobals.mainGroup.node().getBoundingClientRect();
  const tooltipWidth = tooltipD3.node().offsetWidth;
  const tooltipHeight = tooltipD3.node().offsetHeight;
  let tooltipX = mouseXlocal + mainGroupRect.left + 10; // Offset from mouse position
  let tooltipY = mouseYlocal + mainGroupRect.top + 10; // Offset from mouse position
  // Adjust tooltip position to stay within viewport
  if (tooltipX + tooltipWidth > window.innerWidth) {
    tooltipX = window.innerWidth - tooltipWidth - 10; // 10px padding from right
  }
  if (tooltipY + tooltipHeight > window.innerHeight) {
    tooltipY = window.innerHeight - tooltipHeight - 10; // 10px padding from bottom
  }
  tooltipD3.style('left', `${tooltipX}px`).style('top', `${tooltipY}px`);
  tooltipD3.style('display', 'block');
  tooltipD3.style('pointer-events', 'auto');
  tooltipD3.classed('visible', true);
}

function hideTooltip() {
  const { tooltipD3 } = DOMElements;
  tooltipD3.style('pointer-events', 'none');
  chartGlobals.tooltipHideTimeout = setTimeout(() => {
    tooltipD3
      .transition()
      .duration(100)
      .style('opacity', 0)
      .on('end', () => {
        tooltipD3.style('display', 'none').classed('visible', false);
      });
  }, 200); // Delay hiding to allow for mouseout transition
}

function setupResponsiveHandling() {
  window.addEventListener('resize', handleResize);
  handleResize(); // Initial call to set dimensions
}
function handleResize() {
  const { margin, marginContext } = chartGlobals;
  const containerWidth = DOMElements.chartContainerEl.clientWidth;
  const containerHeight = DOMElements.chartContainerEl.clientHeight;

  chartGlobals.width = containerWidth - margin.left - margin.right;
  chartGlobals.height =
    containerHeight - margin.top - margin.bottom - chartGlobals.heightContext;

  DOMElements.svgD3
    .attr('width', containerWidth)
    .attr('height', containerHeight);

  chartGlobals.mainGroup.attr(
    'transform',
    `translate(${margin.left},${margin.top})`
  );

  chartGlobals.contextMainGroup
    .attr(
      'transform',
      `translate(${margin.left},${
        containerHeight - marginContext.bottom - chartGlobals.heightContext
      })`
    )
    .select('.x-axis.context-axis')
    .attr('transform', `translate(0,${chartGlobals.heightContext})`);

  applyFiltersAndRenderAll(); // Re-render with new dimensions
}
