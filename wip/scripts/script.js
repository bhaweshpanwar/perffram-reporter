let allData = [];
let scaleDataCounts = new Map();
const currentFilters = { scale: null, branches: [] };
const DOMElements = {};
const BRANCH_ICON_SVG = `<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><rect fill="none" height="256" width="256"/><path d="M248,120H187.5a60,60,0,0,0-118.9,0H8a8,8,0,0,0,0,16H68.6a60,60,0,0,0,118.9,0H248a8,8,0,0,0,0-16Z"/></svg>`;
let xScale, yScale, xAxis, yAxis, line, xGrid, yGrid;
let currentChartData = [];

// Application entry point
document.addEventListener('DOMContentLoaded', () => {
  // Cache DOM references for efficient future use
  cacheDOMElements();

  // Fetch the CSV data (static resource assumed to be served from ./fireweed.csv)
  fetch('./../fireweed.csv')
    .then((response) => response.text()) // Convert the response into plain text
    .then((csvText) => {
      allData = parseCSV(csvText).map((d) => ({
        branch: d.branch || 'unknown',
        revision: d.revision,
        scale: +d.scale,
        ctime: new Date(d.ctime * 1000),
        metric: +d.metric,
        commit_message: d.commit_message || `Commit: ${d.revision}`,
      }));
      const counts = d3.rollup(
        allData,
        (v) => v.length,
        (d) => d.scale
      );
      scaleDataCounts = new Map(counts);
      initializeApp(allData);
    })
    .catch(handleError);
});

function initializeApp(data) {
  setupFilterControls(data);
  setupEventListeners();
  applyFiltersAndRender();
  updateLastUpdated(data);
}

function cacheDOMElements() {
  Object.assign(DOMElements, {
    svg: d3.select('#chart-svg'),
    tooltip: d3.select('.tooltip'),
    scaleFilter: document.getElementById('chooseScale'),
    legendContainer: d3.select('#legend-container'),
    lastUpdated: document.getElementById('lastUpdated'),
    branchSelectButton: document.getElementById('branch-select-button'),
    branchFilterDropdown: document.getElementById('branch-filter-dropdown'),
    branchListContainer: document.getElementById('branch-list-container'),
    branchSelectAll: document.getElementById('branch-select-all'),
    branchDeselectAll: document.getElementById('branch-deselect-all'),
    modeZero: document.getElementById('mode-zero'),
    modeZoom: document.getElementById('mode-zoom'),
  });
}

function setupFilterControls(data) {
  // Get unique scale values, sorted numerically
  const uniqueScales = [...scaleDataCounts.keys()].sort((a, b) => a - b);

  // Clear any existing options in the options filters dropdown
  DOMElements.scaleFilter.innerHTML = '';

  // Populate the dropdown with new scale options
  uniqueScales.forEach((scale) => {
    const option = document.createElement('option'); // Create new option element
    option.value = scale; // Set the value of the option to the scale
    const count = scaleDataCounts.get(scale); // Get the count of results for this scale
    option.textContent = `${scale} (${count} results)`; // Set the visible text of the option
    DOMElements.scaleFilter.appendChild(option); //Add the option to the dropdown
  });

  // Set the current selected scale to the first available one, or null if none
  currentFilters.scale = uniqueScales[0] || null;

  // Reflect the selected scale in the dropdown UI
  DOMElements.scaleFilter.value = currentFilters.scale;

  // Update related filters (e.g., branches) based on the selected scale
  updateBranchFilter();
}

function updateYAxis(data, duration = 250) {
  if (!data || data.length === 0 || !yScale) return;

  const yAxisMode = document.querySelector(
    'input[name="y_axis_mode"]:checked'
  ).value;
  const { svg } = DOMElements;

  const [xMin, xMax] = xScale.domain();
  const visibleData = data.filter((d) => d.ctime >= xMin && d.ctime <= xMax);

  if (yAxisMode === 'zoom' && visibleData.length > 0) {
    const yMin = d3.min(visibleData, (d) => d.metric);
    const yMax = d3.max(visibleData, (d) => d.metric);
    yScale.domain([yMin * 0.95, yMax * 1.05]);
  } else {
    const yMax = d3.max(data, (d) => d.metric);
    yScale.domain([0, yMax * 1.05]);
  }

  const t = svg.transition().duration(duration);
  svg.select('.axis.y-axis-group').transition(t).call(yAxis);
  svg.select('.grid.y-grid').transition(t).call(yGrid.scale(yScale));
  svg
    .selectAll('.line')
    .transition(t)
    .attr('d', ([, v]) => line(v));
  svg
    .selectAll('.data-circle')
    .transition(t)
    .attr('cx', (d) => xScale(d.ctime))
    .attr('cy', (d) => yScale(d.metric));
}

function setupEventListeners() {
  DOMElements.scaleFilter.addEventListener('change', (e) => {
    currentFilters.scale = +e.target.value;
    updateBranchFilter(true);
    applyFiltersAndRender();
  });

  document.querySelectorAll('input[name="y_axis_mode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      updateYAxis(currentChartData);
    });
  });

  DOMElements.branchSelectButton.addEventListener('click', () => {
    const isHidden =
      DOMElements.branchFilterDropdown.style.display === 'none' ||
      !DOMElements.branchFilterDropdown.style.display;
    DOMElements.branchFilterDropdown.style.display = isHidden
      ? 'block'
      : 'none';
  });

  document.addEventListener('click', (e) => {
    if (
      !DOMElements.branchSelectButton.contains(e.target) &&
      !DOMElements.branchFilterDropdown.contains(e.target)
    ) {
      DOMElements.branchFilterDropdown.style.display = 'none';
    }
  });

  DOMElements.branchListContainer.addEventListener('change', (e) => {
    if (e.target.type === 'checkbox') {
      currentFilters.branches = Array.from(
        DOMElements.branchListContainer.querySelectorAll('input:checked')
      ).map((cb) => cb.value);
      updateBranchButtonText();
      applyFiltersAndRender();
    }
  });

  DOMElements.branchSelectAll.addEventListener('click', () =>
    toggleAllBranches(true)
  );
  DOMElements.branchDeselectAll.addEventListener('click', () =>
    toggleAllBranches(false)
  );
}

function checkBounds(
  left,
  top,
  tooltipWidth,
  tooltipHeight,
  containerWidth,
  containerHeight
) {
  return (
    top >= 0 &&
    left >= 0 &&
    left + tooltipWidth <= containerWidth &&
    top + tooltipHeight <= containerHeight
  );
}

function applyFiltersAndRender() {
  const dataForScale = allData.filter((d) => d.scale === currentFilters.scale);
  const allBranchesForScale = [...new Set(dataForScale.map((d) => d.branch))]
    .sort()
    .reverse();
  console.log('All branches for scale (ordered):', allBranchesForScale);
  const colorScale = d3
    .scaleOrdinal(d3.schemeTableau10)
    .domain(allBranchesForScale);

  console.log('ColorScale domain set to:', colorScale.domain());
  const filteredData = dataForScale.filter((d) =>
    currentFilters.branches.includes(d.branch)
  );
  renderChart(filteredData, colorScale);
  renderLegend(allBranchesForScale, colorScale);
}

function updateBranchFilter(reset = true) {
  const availableBranches = [
    ...new Set(
      allData
        .filter((d) => d.scale === currentFilters.scale)
        .map((d) => d.branch)
    ),
  ]
    .sort()
    .reverse();
  if (reset) {
    currentFilters.branches = [...availableBranches];
  }
  DOMElements.branchListContainer.innerHTML = '';
  availableBranches.forEach((branch) => {
    const id = `branch-cb-${branch.replace(/\W/g, '-')}`;
    const isChecked = currentFilters.branches.includes(branch);
    const label = document.createElement('label');
    label.setAttribute('for', id);
    label.innerHTML = `<input type="checkbox" id="${id}" value="${branch}" ${
      isChecked ? 'checked' : ''
    }><span>${branch}</span>`;
    DOMElements.branchListContainer.appendChild(label);
  });
  updateBranchButtonText();
}

function updateBranchButtonText() {
  const count = currentFilters.branches.length;
  const total =
    DOMElements.branchListContainer.querySelectorAll('input').length;
  DOMElements.branchSelectButton.textContent =
    count === total
      ? 'All Branches Selected'
      : count === 0
      ? 'No Branches Selected'
      : `${count} Branches Selected`;
}

function toggleAllBranches(select) {
  const checkboxes = DOMElements.branchListContainer.querySelectorAll('input');
  checkboxes.forEach((cb) => (cb.checked = select));
  currentFilters.branches = select
    ? Array.from(checkboxes).map((cb) => cb.value)
    : [];
  updateBranchButtonText();
  applyFiltersAndRender();
}

function renderChart(data, colorScale) {
  currentChartData = data;
  const { svg } = DOMElements;
  svg.selectAll('*').remove();
  if (data.length === 0) {
    svg
      .append('text')
      .attr('x', '50%')
      .attr('y', '50%')
      .attr('text-anchor', 'middle')
      .text('No data for selected filters.')
      .style('fill', '#6b7280');
    return;
  }

  const mainChartHeight = 400;
  const contextChartHeight = 80;
  const spacing = 60;
  svg.attr('height', mainChartHeight + spacing + contextChartHeight);

  const width = svg.node().getBoundingClientRect().width;
  const margin = { top: 20, right: 30, bottom: 40, left: 60 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = mainChartHeight - margin.top - margin.bottom;

  const xInitialDomain = d3.extent(data, (d) => d.ctime);
  const yInitialDomain = [0, d3.max(data, (d) => d.metric) * 1.05];

  xScale = d3.scaleTime().domain(xInitialDomain).range([0, chartWidth]);
  yScale = d3.scaleLinear().domain(yInitialDomain).range([chartHeight, 0]);

  const yAxisMode = document.querySelector(
    'input[name="y_axis_mode"]:checked'
  ).value;
  if (yAxisMode === 'zoom') {
    const yMin = d3.min(data, (d) => d.metric);
    yScale.domain([yMin * 0.95, d3.max(data, (d) => d.metric) * 1.05]);
  }

  const chart = svg
    .append('g')
    .attr('transform', `translate(${margin.left}, ${margin.top})`);
  svg
    .append('defs')
    .append('clipPath')
    .attr('id', 'chart-clip')
    .append('rect')
    .attr('width', chartWidth)
    .attr('height', chartHeight);

  xAxis = d3.axisBottom(xScale).ticks(5).tickFormat(d3.timeFormat('%b %d, %Y'));
  yAxis = d3.axisLeft(yScale).ticks(8);
  xGrid = d3.axisBottom(xScale).ticks(5).tickSize(-chartHeight).tickFormat('');
  yGrid = d3.axisLeft(yScale).tickSize(-chartWidth).tickFormat('');

  chart
    .append('g')
    .attr('class', 'grid x-grid')
    .attr('transform', `translate(0, ${chartHeight})`)
    .call(xGrid);
  chart.append('g').attr('class', 'grid y-grid').call(yGrid);
  const xAxisGroup = chart
    .append('g')
    .attr('class', 'axis x-axis-group')
    .attr('transform', `translate(0, ${chartHeight})`)
    .call(xAxis);
  const yAxisGroup = chart
    .append('g')
    .attr('class', 'axis y-axis-group')
    .call(yAxis);

  const clipArea = chart.append('g').attr('clip-path', 'url(#chart-clip)');

  // X-Axis Label
  // chart
  //   .append('text')
  //   .attr('class', 'axis-label x-label')
  //   .attr('text-anchor', 'middle')
  //   .attr('x', chartWidth / 2) // Center the label horizontally.
  //   .attr('y', chartHeight + margin.bottom - 5) // Position it below the x-axis within the margin area.
  //   .style('fill', '#333')
  //   .text('Commit Date');

  // // Y-Axis Label
  // chart
  //   .append('text')
  //   .attr('class', 'axis-label y-label')
  //   .attr('transform', 'rotate(-90)') // Rotate the label for the Y-axis.
  //   .attr('text-anchor', 'middle')
  //   .attr('y', 0 - margin.left + 20) // Position it to the left of the y-axis.
  //   .attr('x', 0 - chartHeight / 2) // Center it vertically along the chart height.
  //   .style('fill', '#333')
  //   .text('Metric Value');

  line = d3
    .line()
    .x((d) => xScale(d.ctime))
    .y((d) => yScale(d.metric));
  const groupedData = d3.group(data, (d) => d.branch);

  clipArea
    .selectAll('.line')
    .data(groupedData)
    .join('path')
    .attr('class', 'line')
    .attr('fill', 'none')
    .attr('stroke', ([branch]) => colorScale(branch))
    .attr('stroke-width', 2)
    .attr('d', ([, v]) => line(v.sort((a, b) => a.ctime - b.ctime)));

  // chart
  //   .selectAll('.line')
  //   .data(groupedData)
  //   .join('path')
  //   .attr('class', 'line')
  //   .attr('fill', 'none')
  //   .attr('stroke', ([branch]) => colorScale(branch))
  //   .attr('stroke-width', 1.5)
  //   .attr('d', ([, v]) => line(v.sort((a, b) => a.ctime - b.ctime)));

  const contextTopPosition = mainChartHeight + margin.top;
  const contextGroup = svg
    .append('g')
    .attr('class', 'context')
    .attr('transform', `translate(${margin.left}, ${contextTopPosition})`);
  const xScale2 = d3.scaleTime().domain(xInitialDomain).range([0, chartWidth]);
  const yContextDomain = [0, d3.max(data, (d) => d.metric) * 1.05];
  const yScale2 = d3
    .scaleLinear()
    .domain(yContextDomain)
    .range([contextChartHeight, 0]);

  const contextLine = d3
    .line()
    .x((d) => xScale2(d.ctime))
    .y((d) => yScale2(d.metric));

  contextGroup
    .selectAll('.context-line')
    .data(groupedData)
    .join('path')
    .attr('fill', 'none')
    .attr('stroke', ([b]) => colorScale(b))
    .attr('stroke-opacity', 0.7)
    .attr('stroke-width', 1)
    .attr('d', ([, v]) => contextLine(v.sort((a, b) => a.ctime - b.ctime)));
  contextGroup
    .append('g')
    .attr('transform', `translate(0, ${contextChartHeight})`)
    .call(
      d3
        .axisBottom(xScale2)
        .ticks(width / 100)
        .tickFormat(d3.timeFormat('%b %Y'))
    );

  // --- START OF UPDATED BRUSH LOGIC ---

  // Brush for the context chart (bottom navigator)
  const contextBrush = d3
    .brushX()
    .extent([
      [0, 0],
      [chartWidth, contextChartHeight],
    ])
    .on('end', brushedContext);

  const contextBrushGroup = contextGroup
    .append('g')
    .attr('class', 'brush context-brush')
    .call(contextBrush);

  // Brush for the X-Axis of the main chart

  const xAxisBrush = d3
    .brushX()
    .extent([
      [0, 0],
      [chartWidth, chartHeight],
    ])
    .on('end', brushedXAxis);

  const branchCircles = clipArea
    .selectAll('.data-circle')
    .data(data)
    .join('circle')
    .attr('class', 'data-circle')
    .attr('cx', (d) => xScale(d.ctime))
    .attr('cy', (d) => yScale(d.metric))
    .attr('r', 4)
    .attr('fill', (d) => colorScale(d.branch))
    .attr('stroke', 'white')
    .attr('stroke-width', 1);

  // const branchCircles = chart
  //   .selectAll('.data-circle')
  //   .data(data)
  //   .join('circle')
  //   .attr('class', 'data-circle')
  //   .attr('cx', (d) => xScale(d.ctime))
  //   .attr('cy', (d) => yScale(d.metric))
  //   .attr('r', 3.5)
  //   .attr('fill', (d) => colorScale(d.branch))
  //   .attr('stroke', 'white')
  //   .attr('stroke-width', 1);

  const xAxisBrushGroup = clipArea
    .append('g')
    .attr('class', 'brush xaxis-brush')
    .call(xAxisBrush);

  // Add capturing mousedown listener to the main group
  clipArea.on('mousedown.brush-reorder', function (event) {
    // Move brush to front when mousedown occurs
    xAxisBrushGroup.raise();
  });

  // Add brushend event to move brush back
  xAxisBrush.on('end.reorder', function (event) {
    // Move brush back under dots after brushing
    setTimeout(() => {
      branchCircles.raise();
    }, 50);
  });

  // Ensure circles are initially on top
  branchCircles.raise();

  setupTooltip(branchCircles, colorScale, xScale, yScale, margin);

  chart.on('dblclick', resetZoom);
  svg
    .on('mouseover', () => window.addEventListener('keydown', handleKeyDown))
    .on('mouseout', () => window.removeEventListener('keydown', handleKeyDown));

  function redrawChart(duration = 500) {
    const t = svg.transition().duration(duration).ease(d3.easeCubicInOut);
    xAxisGroup.transition(t).call(xAxis.scale(xScale));
    chart.select('.x-grid').transition(t).call(xGrid.scale(xScale));
    updateYAxis(currentChartData, duration);
  }

  // Handler for the new X-Axis brush
  function brushedXAxis(event) {
    if (event.selection) {
      const [x0, x1] = event.selection.map(xScale.invert);
      xScale.domain([x0, x1]);
      xAxisBrushGroup.call(xAxisBrush.move, null);
      contextBrushGroup.call(contextBrush.move, xScale.domain().map(xScale2));
      redrawChart();
    }
  }

  // Handler for the context (bottom) brush
  function brushedContext(event) {
    if (event.selection) {
      const [x0, x1] = event.selection.map(xScale2.invert);
      xScale.domain([x0, x1]);
      redrawChart();
      xAxisBrushGroup.call(xAxisBrush.move, null);
    }
  }

  function resetZoom() {
    xScale.domain(xInitialDomain);
    contextBrushGroup.call(contextBrush.move, null);
    xAxisBrushGroup.call(xAxisBrush.move, null);
    redrawChart();
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      resetZoom();
      return;
    }
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      const percentage = event.key === 'ArrowLeft' ? -0.1 : 0.1;
      const [x0, x1] = xScale.domain();
      const shift = (x1 - x0) * percentage;
      xScale.domain([
        new Date(x0.getTime() + shift),
        new Date(x1.getTime() + shift),
      ]);
      contextBrushGroup.call(contextBrush.move, xScale.domain().map(xScale2));
      xAxisBrushGroup.call(xAxisBrush.move, null);
      redrawChart(100);
    }
  };
}

function setupTooltip(circles, colorScale, xScale, yScale, margin) {
  const tooltip = DOMElements.tooltip;
  const container = d3.select('main'); // The main content area is our boundary

  circles
    .style('cursor', 'pointer')
    .on('mouseover', function (event, d) {
      const circle = d3.select(this).style('cursor', 'pointer').attr('r', 7);

      // 1. Set content and make tooltip visible to measure its size
      // add time also
      tooltip
        .html(
          `<div class="tooltip-date">${d3.timeFormat('%A, %B %d, %Y')(
            d.ctime
          )}</div><div class="version-item"><span class="version-color" style="background-color:${colorScale(
            d.branch
          )}"></span><span class="version-name">${
            d.branch
          }</span><span class="version-value">${d.metric.toFixed(
            2
          )}</span></div><div class="commit-details"><strong>Revision:</strong> ${d.revision.substring(
            0,
            10
          )}...<br><a href="https://github.com/postgres/postgres/commit/${
            d.revision
          }" target="_blank">View on GitHub</a></div>`
        )
        .classed('show', true);

      // 2. Get dimensions
      const tooltipNode = tooltip.node();
      const tooltipWidth = tooltipNode.offsetWidth;
      const tooltipHeight = tooltipNode.offsetHeight;
      const containerRect = container.node().getBoundingClientRect();
      const offset = 25; // Space between point and tooltip

      // 3. Get the CIRCLE's screen position, not the mouse's. This is the key fix.
      const point = DOMElements.svg.node().createSVGPoint();
      point.x = xScale(d.ctime) + margin.left;
      point.y = yScale(d.metric) + margin.top;
      const screenPos = point.matrixTransform(
        DOMElements.svg.node().getScreenCTM()
      );

      // Convert the circle's absolute screen position to be relative to the container
      const pointX = screenPos.x - containerRect.left;
      const pointY = screenPos.y - containerRect.top;

      // --- OVERFLOW-AWARE POSITIONING LOGIC ---
      const placements = ['top', 'right', 'bottom', 'left'];
      let finalPlacement = '';
      let finalLeft = 0;
      let finalTop = 0;

      for (const placement of placements) {
        let left, top;
        switch (placement) {
          case 'top':
            left = pointX - tooltipWidth / 2;
            top = pointY - tooltipHeight - offset;
            break;
          case 'right':
            left = pointX + offset;
            top = pointY - tooltipHeight / 2;
            break;
          case 'bottom':
            left = pointX - tooltipWidth / 2;
            top = pointY + offset;
            break;
          case 'left':
            left = pointX - tooltipWidth - offset;
            top = pointY - tooltipHeight / 2;
            break;
        }

        if (
          checkBounds(
            left,
            top,
            tooltipWidth,
            tooltipHeight,
            containerRect.width,
            containerRect.height
          )
        ) {
          finalPlacement = placement;
          finalLeft = left;
          finalTop = top;
          break; // Found a valid placement
        }
      }

      // Fallback if no position fits
      if (!finalPlacement) {
        finalPlacement = 'top';
        finalLeft = pointX - tooltipWidth / 2;
        finalTop = pointY - tooltipHeight - offset;
      }

      const arrowMap = {
        top: 'arrow-down',
        right: 'arrow-left',
        bottom: 'arrow-up',
        left: 'arrow-right',
      };

      tooltip
        .attr('class', 'tooltip show') // Reset classes
        .classed(arrowMap[finalPlacement], true)
        .style('left', `${finalLeft + 10}px`)
        .style('top', `${finalTop + 18}px`);
    })
    .on('mouseout', function () {
      d3.select(this).style('cursor', 'pointer').transition().attr('r', 4);

      // Use setTimeout to allow for cursor to move to tooltip
      setTimeout(() => {
        if (!tooltip.node().matches(':hover')) {
          tooltip.classed('show', false);
        }
      }, 50);
    });

  // Add a listener to the tooltip itself
  tooltip.on('mouseleave', () => {
    tooltip.classed('show', false);
  });
}

// .on('mouseout', function () {
//       d3.select(this)
//         .style('cursor', 'pointer')
//         .transition()
//         .duration(150)
//         .attr('r', 4);

//       // Use setTimeout to allow for cursor to move to tooltip
//       setTimeout(() => {
//         if (!tooltip.node().matches(':hover')) {
//           tooltip.classed('show', false);
//         }
//       }, 50);
//     });

//   tooltip.on('mouseleave', () => {
//     tooltip.classed('show', false);
//   });
// }

// function setupTooltip(circles, colorScale, xScale, yScale, margin) {
//   const tooltip = DOMElements.tooltip;
//   const container = d3.select('main');
//   const offset = 0;
//   const arrowMap = {
//     top: 'arrow-down',
//     right: 'arrow-left',
//     bottom: 'arrow-up',
//     left: 'arrow-right',
//   };

//   // Pre-calculate static elements
//   const tooltipNode = tooltip.node();
//   const containerRect = container.node().getBoundingClientRect();

//   circles
//     .style('cursor', 'pointer')
//     .on('mouseover', function (event, d) {
//       const circle = d3
//         .select(this)
//         .style('cursor', 'pointer')
//         .transition()
//         .duration(150)
//         .attr('r', 7);

//       tooltip
//         .html(
//           `<div class="tooltip-date">${d3.timeFormat('%A, %B %d, %Y')(
//             d.ctime
//           )}</div>
//                 <div class="version-item">
//                     <span class="version-color" style="background-color:${colorScale(
//                       d.branch
//                     )}"></span>
//                     <span class="version-name">${d.branch}</span>
//                     <span class="version-value">${d.metric.toFixed(2)}</span>
//                 </div>
//                 <div class="commit-details">
//                     <strong>Revision:</strong> ${d.revision.substring(
//                       0,
//                       10
//                     )}...<br>
//                     <a href="https://github.com/postgres/postgres/commit/${
//                       d.revision
//                     }" target="_blank">View on GitHub</a>
//                 </div>`
//         )
//         .classed('show', true);

//       // Get dimensions after content is set
//       const tooltipWidth = tooltipNode.offsetWidth;
//       const tooltipHeight = tooltipNode.offsetHeight;

//       // Calculate position
//       const point = DOMElements.svg.node().createSVGPoint();
//       point.x = xScale(d.ctime) + margin.left;
//       point.y = yScale(d.metric) + margin.top;
//       const screenPos = point.matrixTransform(
//         DOMElements.svg.node().getScreenCTM()
//       );
//       const pointX = screenPos.x - containerRect.left;
//       const pointY = screenPos.y - containerRect.top;

//       // Simplified positioning logic (you can keep your original if needed)
//       let left = pointX - tooltipWidth / 2;
//       let top = pointY - tooltipHeight - offset;
//       let placement = 'top';

//       // Adjust if out of bounds (simplified example)
//       if (top < 0) {
//         top = pointY + offset;
//         placement = 'bottom';
//       }
//       if (left < 0) left = 0;
//       if (left + tooltipWidth > containerRect.width)
//         left = containerRect.width - tooltipWidth;

//       tooltip
//         .attr('class', 'tooltip show')
//         .classed(arrowMap[placement], true)
//         .style('left', `${left}px`)
//         .style('top', `${top}px`);
//     })
//     .on('mouseout', function () {
//       d3.select(this)
//         .style('cursor', 'pointer')
//         .transition()
//         .duration(150)
//         .attr('r', 4);

//       // Use setTimeout to allow for cursor to move to tooltip
//       setTimeout(() => {
//         if (!tooltip.node().matches(':hover')) {
//           tooltip.classed('show', false);
//         }
//       }, 50);
//     });

//   tooltip.on('mouseleave', () => {
//     tooltip.classed('show', false);
//   });
// }

function renderLegend(branches, colorScale) {
  console.log('Rendering legend with branches:', branches);

  const { legendContainer } = DOMElements;

  const items = legendContainer
    .selectAll('.legend-item')
    .data(branches, (d) => d)
    .join(
      (enter) => {
        const item = enter
          .append('div')
          .attr('class', 'legend-item')
          .attr('data-branch', (d) => d);

        item.on('click', (event, d) => {
          const checkbox = DOMElements.branchListContainer.querySelector(
            `input[value="${d}"]`
          );
          if (checkbox) {
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
        return item;
      },
      (update) => update, // Return update selection
      (exit) => exit.remove()
    );

  // Apply HTML and colors to ALL items (both new and existing)
  items
    .html((d) => `${BRANCH_ICON_SVG}<span>${d}</span>`)
    .each(function (d) {
      console.log(`Setting color for branch ${d}:`, colorScale(d));
      d3.select(this).select('svg path').attr('fill', colorScale(d));
    });

  // Apply inactive class to ALL items
  items.classed('inactive', (d) => !currentFilters.branches.includes(d));
}

function updateLastUpdated(data) {
  if (!data || data.length === 0) return;
  const maxDate = d3.max(data, (d) => d.ctime);
  DOMElements.lastUpdated.textContent = `Last updated: ${d3.timeFormat(
    '%b %d, %Y'
  )(maxDate)}`;
}

function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.match(/(".*?"|[^",\n]+)(?=\s*,|\s*$)/g) || [];
    return headers.reduce((obj, header, i) => {
      obj[header] = values[i] ? values[i].replace(/^"|"$/g, '').trim() : '';
      return obj;
    }, {});
  });
}

function handleError(error) {
  console.error('Error:', error);
  DOMElements.svg.selectAll('*').remove();
  DOMElements.svg
    .append('text')
    .attr('x', '50%')
    .attr('y', '50%')
    .attr('text-anchor', 'middle')
    .attr('fill', 'red')
    .text(`Error: ${error.message}`);
}
