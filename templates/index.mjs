// The template roster. Each is data for a layout in lib/layouts.mjs: the content is a realistic example of its use, so a
// template is also a sample diagram and a test case. `format` says how the canvas behaves once it's made.
export const TEMPLATES = [
	{
		id: 'flowchart', group: 'process', title: 'Flowchart', format: 'process', kind: 'flow', use: 'A process with decisions: how something gets done, and what happens when it goes wrong.', direction: 'DOWN', route: 'elbow', gap: 70, layerGap: 60, boxWidth: 190,
		nodes: [
			{ id: 'start', text: 'User submits sign-in', shape: 'oval', color: 'green' },
			{ id: 'known', text: 'Known account?', shape: 'diamond', color: 'orange' },
			{ id: 'password', text: 'Check password', detail: 'Hashed compare against the stored credential. Rate limited per account and per address.' },
			{ id: 'valid', text: 'Password valid?', shape: 'diamond', color: 'orange' },
			{ id: 'mfa', text: 'Ask for second factor' },
			{ id: 'signup', text: 'Offer sign-up' },
			{ id: 'lock', text: 'Count failed attempt', detail: 'Locks for 15 minutes after five failures, and notifies the account owner.' },
			{ id: 'session', text: 'Create session', color: 'blue' },
			{ id: 'done', text: 'Signed in', shape: 'oval', color: 'green' },
		],
		edges: [
			{ from: 'start', to: 'known' }, { from: 'known', to: 'password', label: 'yes' }, { from: 'known', to: 'signup', label: 'no' }, { from: 'password', to: 'valid' },
			{ from: 'valid', to: 'mfa', label: 'yes' }, { from: 'valid', to: 'lock', label: 'no' }, { from: 'mfa', to: 'session' }, { from: 'session', to: 'done' },
		],
	},
	{
		id: 'swimlane', group: 'process', title: 'Swimlane process', format: 'process', kind: 'lanes', use: 'A process across several people or teams, so handoffs show.',
		lanes: [{ id: 'employee', label: 'Employee', color: 'blue' }, { id: 'manager', label: 'Manager', color: 'orange' }, { id: 'finance', label: 'Finance', color: 'green' }],
		steps: [
			{ id: 'submit', lane: 'employee', col: 0, text: 'Submit expense' },
			{ id: 'review', lane: 'manager', col: 1, text: 'Review claim' },
			{ id: 'ok', lane: 'manager', col: 2, text: 'Within budget?', shape: 'diamond' },
			{ id: 'fix', lane: 'employee', col: 2, text: 'Correct and resubmit' },
			{ id: 'audit', lane: 'finance', col: 3, text: 'Check receipts', detail: 'Receipts over 75 are checked by hand, and the rest by sample.' },
			{ id: 'pay', lane: 'finance', col: 4, text: 'Pay out' },
			{ id: 'told', lane: 'employee', col: 4, text: 'Notified of payment' },
		],
		edges: [
			{ from: 'submit', to: 'review' }, { from: 'review', to: 'ok' }, { from: 'ok', to: 'fix', label: 'no' }, { from: 'ok', to: 'audit', label: 'yes' }, { from: 'audit', to: 'pay' }, { from: 'pay', to: 'told' },
		],
	},
	{
		id: 'org-chart', group: 'structure', title: 'Org chart', format: 'hierarchy', kind: 'tree', use: 'Who reports to whom.', route: 'elbow', head: 'none', levelColors: ['black', 'blue', 'light-blue'], boxWidth: 170,
		root: { text: 'Chief Executive', children: [
			{ text: 'Product', children: [{ text: 'Design' }, { text: 'Research' }] },
			{ text: 'Engineering', detail: 'Platform and application teams, about 40 people.', children: [{ text: 'Platform' }, { text: 'Applications' }, { text: 'Data' }] },
			{ text: 'Operations', children: [{ text: 'Finance' }, { text: 'People' }] },
		] },
	},
	{
		id: 'decision-tree', group: 'structure', title: 'Decision tree', format: 'hierarchy', kind: 'tree', use: 'Choosing between outcomes, one question at a time.', boxWidth: 190, levelColors: ['black', 'orange', 'green'], layerGap: 110,
		root: { text: 'Is the data relational?', children: [
			{ text: 'Over 1 TB?', edge: 'yes', children: [{ text: 'Partitioned Postgres', edge: 'yes' }, { text: 'Plain Postgres', edge: 'no' }] },
			{ text: 'Mostly key lookups?', edge: 'no', children: [{ text: 'Key-value store', edge: 'yes' }, { text: 'Document store', edge: 'no' }] },
		] },
	},
	{
		id: 'mind-map', group: 'structure', title: 'Mind map', format: 'hierarchy', kind: 'mindmap', use: 'Getting ideas out and grouping them, around one central topic.',
		root: { text: 'Launch plan', children: [
			{ text: 'Audience', children: [{ text: 'Existing customers' }, { text: 'Trade press' }, { text: 'New segments' }] },
			{ text: 'Message', children: [{ text: 'Core promise' }, { text: 'Proof points' }] },
			{ text: 'Channels', children: [{ text: 'Email' }, { text: 'Web' }, { text: 'Events' }, { text: 'Partners' }] },
			{ text: 'Risks', children: [{ text: 'Timing' }, { text: 'Support load' }] },
			{ text: 'Measures', children: [{ text: 'Sign-ups' }, { text: 'Activation' }, { text: 'Retention' }] },
		] },
	},
	{
		id: 'sequence', group: 'process', title: 'Sequence diagram', format: 'process', kind: 'sequence', use: 'Who says what to whom, in order: protocols and integrations.',
		participants: [{ id: 'browser', text: 'Browser' }, { id: 'app', text: 'App server' }, { id: 'idp', text: 'Identity provider' }, { id: 'api', text: 'Resource API' }],
		messages: [
			{ from: 'browser', to: 'app', text: 'Open /account' }, { from: 'app', to: 'browser', text: 'Redirect to sign-in', reply: true }, { from: 'browser', to: 'idp', text: 'Sign in' },
			{ from: 'idp', to: 'browser', text: 'Authorization code', reply: true }, { from: 'browser', to: 'app', text: 'Code' }, { from: 'app', to: 'idp', text: 'Exchange code' }, { from: 'idp', to: 'app', text: 'Tokens', reply: true },
			{ from: 'app', to: 'api', text: 'Fetch profile' }, { from: 'api', to: 'app', text: 'Profile', reply: true }, { from: 'app', to: 'browser', text: 'Render page', reply: true },
		],
	},
	{
		id: 'architecture', group: 'system', title: 'Layered architecture', format: 'system', kind: 'stack', use: 'How a system is layered, and what talks to what.',
		tiers: [
			{ id: 'clients', label: 'Clients', color: 'blue', items: [{ id: 'web', text: 'Web app' }, { id: 'mobile', text: 'Mobile app' }, { id: 'partners', text: 'Partner API clients' }] },
			{ id: 'edge', label: 'Edge', color: 'violet', items: [{ id: 'cdn', text: 'CDN' }, { id: 'gateway', text: 'API gateway', detail: 'Authentication, rate limits and routing.' }] },
			{ id: 'services', label: 'Services', color: 'green', items: [{ id: 'accounts', text: 'Accounts' }, { id: 'orders', text: 'Orders' }, { id: 'notify', text: 'Notifications' }, { id: 'search', text: 'Search' }] },
			{ id: 'data', label: 'Data', color: 'orange', items: [{ id: 'db', text: 'Postgres' }, { id: 'cache', text: 'Redis' }, { id: 'queue', text: 'Queue' }, { id: 'index', text: 'Search index' }] },
		],
		edges: [
			{ from: 'web', to: 'cdn' }, { from: 'mobile', to: 'gateway' }, { from: 'partners', to: 'gateway' }, { from: 'cdn', to: 'gateway' }, { from: 'gateway', to: 'accounts' }, { from: 'gateway', to: 'orders' }, { from: 'gateway', to: 'search' },
			{ from: 'accounts', to: 'db' }, { from: 'orders', to: 'cache' }, { from: 'search', to: 'index' }, { from: 'orders', to: 'queue' }, { from: 'notify', to: 'queue' },
		],
	},
	{
		id: 'services', group: 'system', title: 'Service map', format: 'system', kind: 'flow', use: 'Services and their dependencies, grouped by boundary.', direction: 'RIGHT', gap: 50, layerGap: 100, boxWidth: 150, route: 'elbow',
		groups: [{ id: 'public', label: 'Public' }, { id: 'core', label: 'Core' }, { id: 'stores', label: 'Stores' }],
		nodes: [
			{ id: 'site', text: 'Web shop', group: 'public', color: 'blue' }, { id: 'cart', text: 'Cart', group: 'public', color: 'blue' },
			{ id: 'ord', text: 'Orders', group: 'core', color: 'green' }, { id: 'pay', text: 'Payments', group: 'core', color: 'green' }, { id: 'stock', text: 'Inventory', group: 'core', color: 'green' },
			{ id: 'pg', text: 'Postgres', group: 'stores', color: 'orange' }, { id: 'mail', text: 'Email', group: 'stores', color: 'orange' },
		],
		edges: [{ from: 'site', to: 'cart' }, { from: 'cart', to: 'ord' }, { from: 'ord', to: 'pay' }, { from: 'ord', to: 'stock' }, { from: 'stock', to: 'pg' }, { from: 'pay', to: 'pg' }, { from: 'pay', to: 'mail' }],
	},
	{
		id: 'network', group: 'system', title: 'Network topology', format: 'system', kind: 'tree', use: 'How machines and networks connect.', boxWidth: 170, head: 'none', levelColors: ['violet', 'blue', 'green', 'grey'],
		root: { text: 'Internet', shape: 'cloud', children: [
			{ text: 'Firewall', children: [
				{ text: 'Public subnet', children: [{ text: 'Load balancer' }, { text: 'Bastion host' }] },
				{ text: 'Private subnet', children: [{ text: 'App servers' }, { text: 'Workers' }, { text: 'Database' }] },
			] },
		] },
	},
	{
		id: 'er-diagram', group: 'system', title: 'Entity relationships', format: 'system', kind: 'flow', use: 'A data model: what is stored, and how it relates.', direction: 'RIGHT', boxWidth: 190, gap: 70, layerGap: 140,
		nodes: [
			{ id: 'user', text: 'User\nid, email, name', color: 'blue' }, { id: 'post', text: 'Post\nid, title, body', color: 'blue' }, { id: 'comment', text: 'Comment\nid, body', color: 'blue' }, { id: 'tag', text: 'Tag\nid, name', color: 'blue' }, { id: 'posttag', text: 'PostTag\npost_id, tag_id', color: 'grey' },
		],
		edges: [{ from: 'user', to: 'post', label: '1 to many' }, { from: 'post', to: 'comment', label: '1 to many' }, { from: 'user', to: 'comment', label: '1 to many' }, { from: 'post', to: 'posttag', label: '1 to many' }, { from: 'posttag', to: 'tag', label: 'many to 1' }],
	},
	{
		id: 'state-machine', group: 'process', title: 'State machine', format: 'process', kind: 'flow', use: 'The states something moves through, and what moves it.', direction: 'RIGHT', gap: 90, layerGap: 110, boxWidth: 130,
		nodes: [
			{ id: 'draft', text: 'Draft', shape: 'oval', color: 'grey' }, { id: 'placed', text: 'Placed', shape: 'oval', color: 'blue' }, { id: 'paid', text: 'Paid', shape: 'oval', color: 'blue' }, { id: 'shipped', text: 'Shipped', shape: 'oval', color: 'blue' }, { id: 'delivered', text: 'Delivered', shape: 'oval', color: 'green' }, { id: 'cancelled', text: 'Cancelled', shape: 'oval', color: 'red' },
		],
		edges: [{ from: 'draft', to: 'placed', label: 'checkout' }, { from: 'placed', to: 'paid', label: 'payment' }, { from: 'paid', to: 'shipped', label: 'dispatch' }, { from: 'shipped', to: 'delivered', label: 'receipt' }, { from: 'placed', to: 'cancelled', label: 'cancel' }, { from: 'paid', to: 'cancelled', label: 'refund' }],
	},
	{
		id: 'pipeline', group: 'process', title: 'Build pipeline', format: 'process', kind: 'flow', use: 'Stages with dependencies: builds, data pipelines, project plans.', direction: 'RIGHT', gap: 50, layerGap: 70, boxWidth: 130, route: 'elbow',
		nodes: [
			{ id: 'checkout', text: 'Checkout', color: 'grey' }, { id: 'lint', text: 'Lint', color: 'blue' }, { id: 'unit', text: 'Unit tests', color: 'blue' }, { id: 'build', text: 'Build image', color: 'blue' }, { id: 'e2e', text: 'End-to-end tests', color: 'violet' }, { id: 'scan', text: 'Security scan', color: 'violet' }, { id: 'staging', text: 'Deploy to staging', color: 'orange' }, { id: 'approve', text: 'Approve', shape: 'diamond', color: 'orange' }, { id: 'prod', text: 'Deploy to production', color: 'green' },
		],
		edges: [{ from: 'checkout', to: 'lint' }, { from: 'checkout', to: 'unit' }, { from: 'lint', to: 'build' }, { from: 'unit', to: 'build' }, { from: 'build', to: 'e2e' }, { from: 'build', to: 'scan' }, { from: 'e2e', to: 'staging' }, { from: 'scan', to: 'staging' }, { from: 'staging', to: 'approve' }, { from: 'approve', to: 'prod' }],
	},
	{
		id: 'roadmap', group: 'time', title: 'Roadmap', format: 'timeline', kind: 'gantt', use: 'What happens when, by team or workstream.', units: ['Q1', 'Q2', 'Q3', 'Q4'], unitWidth: 240,
		lanes: [
			{ label: 'Product', color: 'blue', bars: [{ text: 'Research', start: 0, end: 1 }, { text: 'Beta', start: 1, end: 2.5 }, { text: 'General release', start: 2.5, end: 4 }] },
			{ label: 'Platform', color: 'green', bars: [{ text: 'Migration', start: 0, end: 2 }, { text: 'Scale work', start: 1.5, end: 3.5 }] },
			{ label: 'Go to market', color: 'orange', bars: [{ text: 'Positioning', start: 1, end: 2 }, { text: 'Launch campaign', start: 2.5, end: 3.5 }] },
		],
	},
	{
		id: 'timeline', group: 'time', title: 'Timeline', format: 'timeline', kind: 'timeline', use: 'Events in order: a history, an incident, a project.',
		items: [
			{ when: '09:02', text: 'Alert fires' }, { when: '09:06', text: 'On-call acknowledges' }, { when: '09:15', text: 'Bad deploy suspected', color: 'orange' }, { when: '09:21', text: 'Rollback starts', color: 'orange' }, { when: '09:34', text: 'Error rate recovers', color: 'green' }, { when: '10:30', text: 'All clear', color: 'green', detail: 'Followed by a review two days later.' },
		],
	},
	{
		id: 'kanban', group: 'work', title: 'Kanban board', format: 'board', kind: 'board', use: 'Work by status.',
		columns: [
			{ label: 'To do', color: 'grey', cards: [{ text: 'Write onboarding guide' }, { text: 'Audit permissions' }, { text: 'Update pricing page' }] },
			{ label: 'In progress', color: 'blue', cards: [{ text: 'Billing migration' }, { text: 'Search relevance' }] },
			{ label: 'In review', color: 'violet', cards: [{ text: 'Mobile sign-in' }] },
			{ label: 'Done', color: 'green', cards: [{ text: 'New dashboard' }, { text: 'Export to CSV' }, { text: 'Fix date filters' }, { text: 'Upgrade database' }] },
		],
	},
	{
		id: 'quadrant', group: 'decide', title: '2x2 matrix', format: 'board', kind: 'quadrant', use: 'Sorting options along two dimensions.', yAxis: 'Impact (low at the bottom, high at the top)', xAxis: 'Effort (low on the left, high on the right)',
		quadrants: [
			{ label: 'Quick wins', color: 'green', items: ['Better empty states', 'Faster search', 'Saved filters'] },
			{ label: 'Big bets', color: 'blue', items: ['Offline mode', 'Public API'] },
			{ label: 'Fill-ins', color: 'grey', items: ['New icons', 'Dark-mode polish'] },
			{ label: 'Avoid', color: 'red', items: ['Custom themes', 'Legacy importer', 'Desktop app'] },
		],
	},
	{
		id: 'journey-map', group: 'work', title: 'Customer journey', format: 'board', kind: 'grid', use: 'A person’s experience across stages, and where it hurts.',
		columns: ['Discover', 'Compare', 'Sign up', 'First use', 'Renew'],
		rows: [
			{ label: 'Doing', color: 'blue', cells: ['Reads a review', 'Checks pricing', 'Creates an account', 'Imports data', 'Gets a reminder'] },
			{ label: 'Feeling', color: 'orange', cells: ['Curious', 'Unsure', 'Impatient', 'Relieved', 'Indifferent'] },
			{ label: 'Pain', color: 'red', cells: ['', 'Plans are hard to compare', 'Too many fields', 'Import errors are vague', 'Renewal is a surprise'] },
			{ label: 'Idea', color: 'green', cells: ['', 'Plan chooser', 'Sign up with a link', 'Show what to fix', 'Warn a month ahead'] },
		],
	},
	{
		id: 'responsibility', group: 'work', title: 'Responsibility chart', format: 'board', kind: 'grid', use: 'Who is responsible, accountable, consulted and informed.', cellWidth: 150, labelWidth: 210,
		columns: ['Product', 'Engineering', 'Design', 'Legal'],
		rows: [
			{ label: 'Set requirements', cells: [{ text: 'Accountable', color: 'blue' }, { text: 'Consulted' }, { text: 'Consulted' }, { text: 'Informed' }] },
			{ label: 'Design the flow', cells: [{ text: 'Consulted' }, { text: 'Consulted' }, { text: 'Accountable', color: 'blue' }, { text: 'Informed' }] },
			{ label: 'Build it', cells: [{ text: 'Informed' }, { text: 'Accountable', color: 'blue' }, { text: 'Consulted' }, { text: '' }] },
			{ label: 'Review terms', cells: [{ text: 'Consulted' }, { text: 'Informed' }, { text: '' }, { text: 'Accountable', color: 'blue' }] },
		],
	},
	{
		id: 'comparison', group: 'decide', title: 'Comparison table', format: 'board', kind: 'grid', use: 'Weighing options against criteria.', cellWidth: 230,
		columns: ['Build it', 'Buy it', 'Partner'],
		rows: [
			{ label: 'Cost', cells: ['High up front', 'Yearly licence', 'Revenue share'] },
			{ label: 'Time to ship', cells: ['Six months', 'Six weeks', 'Three months'] },
			{ label: 'Control', cells: [{ text: 'Full', color: 'green' }, { text: 'Limited', color: 'orange' }, { text: 'Shared', color: 'orange' }] },
			{ label: 'Risk', cells: ['Delivery', { text: 'Vendor lock-in', color: 'red' }, 'Partner priorities'] },
		],
	},
	{
		id: 'fishbone', group: 'decide', title: 'Fishbone diagram', format: 'hierarchy', kind: 'fishbone', use: 'Finding the causes behind a problem.', effect: 'Checkout failures up 40%',
		causes: [
			{ label: 'People', color: 'blue', items: ['New on-call rota', 'Handover gaps'] }, { label: 'Process', color: 'orange', items: ['No staged rollout', 'Manual config'] },
			{ label: 'Technology', color: 'green', items: ['Payment timeouts', 'Retry storms'] }, { label: 'Vendors', color: 'violet', items: ['Provider outage', 'API version change'] },
		],
	},
	{
		id: 'funnel', group: 'process', title: 'Funnel', format: 'process', kind: 'funnel', use: 'Stages that narrow, and where people drop out.',
		stages: [{ text: 'Visit the site: 40,000' }, { text: 'Start sign-up: 6,000', drop: '85% leave' }, { text: 'Finish sign-up: 3,600', drop: '40% leave' }, { text: 'Activate: 1,500', drop: '58% leave' }, { text: 'Pay: 450', drop: '70% leave' }],
	},
	{
		id: 'cycle', group: 'process', title: 'Cycle', format: 'process', kind: 'cycle', use: 'A loop that repeats: plan, do, check, act.', centre: 'Continuous improvement',
		colors: ['blue', 'green', 'orange', 'violet'], stages: [{ text: 'Plan', detail: 'Decide what to change and how to measure it.' }, { text: 'Do' }, { text: 'Check' }, { text: 'Act' }],
	},

	// ---- more blocks: everyday shapes of work, in the same layouts ------------------------------------------------------------
	{
		id: 'retro', group: 'work', title: 'Retrospective', format: 'board', kind: 'board', use: 'Looking back on a stretch of work: what to keep, what to change, what to try.',
		columns: [
			{ label: 'Went well', color: 'green', cards: [{ text: 'Shipped search on time' }, { text: 'Pairing on the hard bugs' }, { text: 'Clear launch checklist' }] },
			{ label: 'To improve', color: 'orange', cards: [{ text: 'Late design changes' }, { text: 'Flaky end-to-end tests', detail: 'Three releases were held up by tests that failed and then passed on a rerun.' }] },
			{ label: 'Try next', color: 'blue', cards: [{ text: 'Design freeze a week out' }, { text: 'Quarantine flaky tests' }] },
		],
	},
	{
		id: 'pros-cons', group: 'decide', title: 'Pros and cons', format: 'board', kind: 'board', use: 'One choice, weighed: what speaks for it, what against, and what you still need to know.',
		columns: [
			{ label: 'For', color: 'green', cards: [{ text: 'Cuts hosting cost by a third' }, { text: 'Team already knows it' }, { text: 'Better local development' }] },
			{ label: 'Against', color: 'red', cards: [{ text: 'Migration takes a quarter' }, { text: 'Two services need rewrites' }] },
			{ label: 'Still to find out', color: 'grey', cards: [{ text: 'Support terms' }, { text: 'Data residency' }] },
		],
	},
	{
		id: 'sipoc', group: 'process', title: 'SIPOC', format: 'board', kind: 'board', use: 'A process at a glance: suppliers, inputs, steps, outputs and customers.',
		columns: [
			{ label: 'Suppliers', color: 'grey', cards: [{ text: 'Sales team' }, { text: 'Payment provider' }] },
			{ label: 'Inputs', color: 'violet', cards: [{ text: 'Signed order' }, { text: 'Payment' }] },
			{ label: 'Process', color: 'blue', cards: [{ text: 'Check order' }, { text: 'Provision account' }, { text: 'Send welcome' }] },
			{ label: 'Outputs', color: 'green', cards: [{ text: 'Live account' }, { text: 'Invoice' }] },
			{ label: 'Customers', color: 'orange', cards: [{ text: 'New customer' }, { text: 'Finance' }] },
		],
	},
	{
		id: 'swot', group: 'decide', title: 'SWOT', format: 'board', kind: 'quadrant', use: 'Strengths, weaknesses, opportunities and threats: where you stand before a plan.', yAxis: 'Inside at the top, outside below', xAxis: 'Helpful on the left, harmful on the right',
		quadrants: [
			{ label: 'Strengths', color: 'green', items: ['Loyal customers', 'Fast release cycle'] },
			{ label: 'Weaknesses', color: 'orange', items: ['Thin sales team', 'One big customer'] },
			{ label: 'Opportunities', color: 'blue', items: ['New regulation', 'Partner channel'] },
			{ label: 'Threats', color: 'red', items: ['Cheaper rival', 'Rising costs'] },
		],
	},
	{
		id: 'stakeholder-map', group: 'decide', title: 'Stakeholder map', format: 'board', kind: 'quadrant', use: 'Who has a stake, and how closely to involve them, by influence and interest.', yAxis: 'Influence (high at the top)', xAxis: 'Interest (low on the left, high on the right)',
		quadrants: [
			{ label: 'Keep satisfied', color: 'violet', items: ['Finance director', 'Legal'] },
			{ label: 'Manage closely', color: 'red', items: ['Head of sales', 'Product owner'] },
			{ label: 'Monitor', color: 'grey', items: ['Facilities'] },
			{ label: 'Keep informed', color: 'blue', items: ['Support team', 'Power users'] },
		],
	},
	{
		id: 'eisenhower', group: 'decide', title: 'Urgent and important', format: 'board', kind: 'quadrant', use: 'Sorting a to-do list: do now, schedule, delegate or drop.', yAxis: 'Important at the top', xAxis: 'Urgent on the left, not urgent on the right',
		quadrants: [
			{ label: 'Do now', color: 'red', items: ['Fix the outage', 'Reply to the auditor'] },
			{ label: 'Schedule', color: 'blue', items: ['Plan next quarter', 'Hire a lead'] },
			{ label: 'Delegate', color: 'orange', items: ['Book the venue', 'Weekly report'] },
			{ label: 'Drop', color: 'grey', items: ['Rename the wiki'] },
		],
	},
	{
		id: 'empathy-map', group: 'work', title: 'Empathy map', format: 'board', kind: 'quadrant', use: 'What someone says, thinks, does and feels, to design from their side.', yAxis: 'Seen at the top, felt below', xAxis: 'Outward on the left, inward on the right',
		quadrants: [
			{ label: 'Says', color: 'blue', items: ['“I just need the numbers by Friday”'] },
			{ label: 'Does', color: 'green', items: ['Exports to a spreadsheet', 'Checks twice'] },
			{ label: 'Thinks', color: 'violet', items: ['These figures might be stale'] },
			{ label: 'Feels', color: 'orange', items: ['Anxious before reviews'] },
		],
	},
	{
		id: 'okr-tree', group: 'structure', title: 'Goals and key results', format: 'hierarchy', kind: 'tree', use: 'An objective, the results that show it was met, and the work to get there.', route: 'elbow', head: 'none', levelColors: ['black', 'blue', 'green'], boxWidth: 180,
		root: { text: 'Customers stay with us', children: [
			{ text: 'Renewals reach 92%', children: [{ text: 'Health score alerts' }, { text: 'Renewal playbook' }] },
			{ text: 'Time to value under a week', detail: 'Measured from signing to the first report sent.', children: [{ text: 'Guided setup' }, { text: 'Import from rivals' }] },
			{ text: 'Support replies in an hour', children: [{ text: 'Follow-the-sun rota' }] },
		] },
	},
	{
		id: 'five-whys', group: 'decide', title: 'Five whys', format: 'process', kind: 'flow', use: 'Asking why until you reach a cause you can act on.', direction: 'DOWN', gap: 40, layerGap: 50, boxWidth: 260,
		nodes: [
			{ id: 'problem', text: 'Customers were charged twice', color: 'red' },
			{ id: 'why1', text: 'The payment was retried' },
			{ id: 'why2', text: 'The first attempt timed out' },
			{ id: 'why3', text: 'The provider was slow to answer' },
			{ id: 'why4', text: 'Our timeout was two seconds' },
			{ id: 'why5', text: 'Nobody had reviewed it since launch', color: 'orange' },
			{ id: 'cause', text: 'Retries without an idempotency key', color: 'green', detail: 'The fix: send a key with every attempt, so the provider charges once.' },
		],
		edges: [{ from: 'problem', to: 'why1', label: 'why?' }, { from: 'why1', to: 'why2', label: 'why?' }, { from: 'why2', to: 'why3', label: 'why?' }, { from: 'why3', to: 'why4', label: 'why?' }, { from: 'why4', to: 'why5', label: 'why?' }, { from: 'why5', to: 'cause', label: 'so' }],
	},
	{
		id: 'story-map', group: 'work', title: 'User story map', format: 'board', kind: 'grid', use: 'What people do, in order, and what each release lets them do.', cellWidth: 200,
		columns: ['Find a product', 'Choose', 'Pay', 'Track the order'],
		rows: [
			{ label: 'First release', color: 'blue', cells: ['Search by name', 'See price and stock', 'Pay by card', 'Email updates'] },
			{ label: 'Next', color: 'green', cells: ['Filters', 'Compare two', 'Saved cards', 'Live tracking'] },
			{ label: 'Later', color: 'grey', cells: ['Recommendations', 'Reviews', 'Pay later', 'Change delivery'] },
		],
	},
	{
		id: 'decision-log', group: 'decide', title: 'Decision log', format: 'board', kind: 'grid', use: 'What was decided, why, instead of what, and when to look again.', cellWidth: 220, labelWidth: 200,
		columns: ['Decided', 'Because', 'Instead of', 'Revisit if'],
		rows: [
			{ label: 'Database', cells: ['Postgres', 'The team knows it; relational data', 'A document store', 'Write volume grows tenfold'] },
			{ label: 'Hosting', cells: ['One region', 'Customers are in one country', 'Multi-region', 'A customer needs it abroad'] },
			{ label: 'Search', cells: ['Postgres full-text', 'Good enough, one less system', 'A search engine', 'Queries slow past a second'] },
		],
	},
]

/** Blocks and starters, for people and agents choosing one. A starter's `parts` say what it has. */
export const templateList = () => [
	...TEMPLATES.map(({ id, title, use, format, kind, group }) => ({ id, type: 'block', group, title, use, format, kind })),
	...STARTERS.map(({ id, title, use, format, parts }) => ({ id, type: 'starter', title, use, format, parts: parts.map((p) => p.title) })),
]
export const templateById = (id) => TEMPLATES.find((t) => t.id === id) ?? null

/** How blocks are grouped, for people choosing one and for agents. */
export const GROUPS = [
	{ id: 'process', label: 'Processes', about: 'What happens, in what order, and who does it' },
	{ id: 'structure', label: 'Structures', about: 'What belongs under what' },
	{ id: 'system', label: 'Systems', about: 'Named parts and the real connections between them' },
	{ id: 'time', label: 'Time', about: 'Where position means a date' },
	{ id: 'work', label: 'Work', about: 'Tasks, people and experiences' },
	{ id: 'decide', label: 'Decisions', about: 'Weighing options and finding causes' },
]

// Starters: whole canvases made of several blocks on one subject, so a canvas *has* a roadmap and a risk map rather than
// *being* one. Each part is a block (its own content here, so the parts tell one story), laid out under its own heading.
export const STARTERS = [
	{
		id: 'system-design', title: 'System design', format: 'system', use: 'One system from four sides: its parts, a key request through it, its data, and the decisions behind it.',
		parts: [
			{ id: 'parts', title: 'The parts', spec: { kind: 'stack', tiers: [
				{ id: 'clients', label: 'Clients', color: 'blue', items: [{ id: 'web', text: 'Web shop' }, { id: 'app', text: 'Mobile app' }] },
				{ id: 'edge', label: 'Edge', color: 'violet', items: [{ id: 'gateway', text: 'API gateway', detail: 'Sign-in, rate limits and routing.' }] },
				{ id: 'services', label: 'Services', color: 'green', items: [{ id: 'cart', text: 'Cart' }, { id: 'orders', text: 'Orders' }, { id: 'payments', text: 'Payments' }] },
				{ id: 'data', label: 'Data', color: 'orange', items: [{ id: 'db', text: 'Postgres' }, { id: 'queue', text: 'Event queue' }] },
			], edges: [{ from: 'web', to: 'gateway' }, { from: 'app', to: 'gateway' }, { from: 'gateway', to: 'cart' }, { from: 'gateway', to: 'orders' }, { from: 'orders', to: 'payments' }, { from: 'orders', to: 'db' }, { from: 'orders', to: 'queue' }] } },
			{ id: 'checkout', title: 'Checkout, step by step', spec: { kind: 'sequence', participants: [{ id: 'shopper', text: 'Shopper' }, { id: 'orders', text: 'Orders' }, { id: 'payments', text: 'Payments' }, { id: 'queue', text: 'Event queue' }], messages: [
				{ from: 'shopper', to: 'orders', text: 'Place order' }, { from: 'orders', to: 'payments', text: 'Charge card' }, { from: 'payments', to: 'orders', text: 'Charged', reply: true },
				{ from: 'orders', to: 'queue', text: 'Order placed' }, { from: 'orders', to: 'shopper', text: 'Confirmation', reply: true },
			] } },
			{ id: 'data', title: 'The data', spec: { kind: 'flow', direction: 'RIGHT', boxWidth: 190, gap: 60, layerGap: 120, nodes: [
				{ id: 'customer', text: 'Customer\nid, email', color: 'blue' }, { id: 'order', text: 'Order\nid, status, total', color: 'blue' }, { id: 'line', text: 'Line\norder_id, sku, qty', color: 'blue' }, { id: 'product', text: 'Product\nsku, price, stock', color: 'blue' },
			], edges: [{ from: 'customer', to: 'order', label: '1 to many' }, { from: 'order', to: 'line', label: '1 to many' }, { from: 'line', to: 'product', label: 'many to 1' }] } },
			{ id: 'decisions', title: 'Decisions', spec: { kind: 'grid', cellWidth: 210, labelWidth: 170, columns: ['Decided', 'Because', 'Revisit if'], rows: [
				{ label: 'Events', cells: ['A queue between orders and the rest', 'Checkout must not wait on email', 'Ordering guarantees are needed'] },
				{ label: 'Payments', cells: ['Idempotency keys on every charge', 'Retries must never charge twice', 'The provider supports it natively'] },
			] } },
		],
	},
	{
		id: 'incident-review', title: 'Incident review', format: 'process', use: 'What happened, why, and what changes: a blameless review on one page.',
		parts: [
			{ id: 'timeline', title: 'What happened', spec: { kind: 'timeline', items: [{ when: '09:02', text: 'Alert: checkout errors' }, { when: '09:06', text: 'On-call acknowledges' }, { when: '09:15', text: 'Bad deploy suspected', color: 'orange' }, { when: '09:21', text: 'Rollback starts', color: 'orange' }, { when: '09:34', text: 'Errors recover', color: 'green' }] } },
			{ id: 'causes', title: 'Why', spec: { kind: 'fishbone', effect: 'Checkout failures up 40%', causes: [
				{ label: 'Process', color: 'orange', items: ['No staged rollout', 'Manual config'] }, { label: 'Technology', color: 'green', items: ['Payment timeouts', 'Retry storms'] },
				{ label: 'People', color: 'blue', items: ['New on-call rota'] }, { label: 'Vendors', color: 'violet', items: ['Provider slowdown'] },
			] } },
			{ id: 'actions', title: 'What changes', spec: { kind: 'board', columns: [
				{ label: 'Now', color: 'red', cards: [{ text: 'Staged rollouts for checkout' }, { text: 'Cap payment retries' }] },
				{ label: 'This quarter', color: 'blue', cards: [{ text: 'Config in code review' }, { text: 'On-call shadowing' }] },
				{ label: 'Done', color: 'green', cards: [{ text: 'Rollback runbook updated' }] },
			] } },
		],
	},
	{
		id: 'product-strategy', title: 'Product strategy', format: 'board', use: 'Where a product is going: the goal, the bets, the plan and the risks.',
		parts: [
			{ id: 'goal', title: 'The goal', spec: { kind: 'tree', route: 'elbow', head: 'none', levelColors: ['black', 'blue', 'green'], boxWidth: 180, root: { text: 'Teams run their week here', children: [
				{ text: 'Weekly active teams double', children: [{ text: 'Templates for rituals' }, { text: 'Calendar sync' }] },
				{ text: 'Half of teams invite a guest', children: [{ text: 'Guest access' }] },
			] } } },
			{ id: 'bets', title: 'The bets', spec: { kind: 'quadrant', yAxis: 'Value (high at the top)', xAxis: 'Effort (low on the left, high on the right)', quadrants: [
				{ label: 'Do first', color: 'green', items: ['Templates for rituals', 'Guest access'] }, { label: 'Plan for', color: 'blue', items: ['Calendar sync'] },
				{ label: 'Maybe', color: 'grey', items: ['Themes'] }, { label: 'Not now', color: 'red', items: ['Desktop app'] },
			] } },
			{ id: 'plan', title: 'The plan', spec: { kind: 'gantt', units: ['Q1', 'Q2', 'Q3', 'Q4'], unitWidth: 220, lanes: [
				{ label: 'Product', color: 'blue', bars: [{ text: 'Templates', start: 0, end: 1.5 }, { text: 'Guest access', start: 1.5, end: 3 }] },
				{ label: 'Platform', color: 'green', bars: [{ text: 'Calendar sync', start: 1, end: 3.5 }] },
			] } },
			{ id: 'risks', title: 'The risks', spec: { kind: 'board', columns: [
				{ label: 'Risk', color: 'red', cards: [{ text: 'Guests confuse billing' }, { text: 'Sync is slow to build' }] },
				{ label: 'What we do about it', color: 'green', cards: [{ text: 'Guests never count as seats' }, { text: 'Start with read-only sync' }] },
			] } },
		],
	},
	{
		id: 'project-kickoff', title: 'Project kickoff', format: 'board', use: 'Starting a project together: what it is for, who does what, the plan and who to keep close.',
		parts: [
			{ id: 'why', title: 'What it is for', spec: { kind: 'tree', route: 'elbow', head: 'none', levelColors: ['black', 'blue'], boxWidth: 190, root: { text: 'New customer portal', children: [{ text: 'Customers serve themselves' }, { text: 'Support calls drop a third' }, { text: 'Live by September' }] } } },
			{ id: 'who', title: 'Who does what', spec: { kind: 'grid', cellWidth: 150, labelWidth: 190, columns: ['Product', 'Engineering', 'Support'], rows: [
				{ label: 'Scope', cells: [{ text: 'Accountable', color: 'blue' }, { text: 'Consulted' }, { text: 'Consulted' }] },
				{ label: 'Build', cells: [{ text: 'Informed' }, { text: 'Accountable', color: 'blue' }, { text: '' }] },
				{ label: 'Launch', cells: [{ text: 'Accountable', color: 'blue' }, { text: 'Consulted' }, { text: 'Responsible' }] },
			] } },
			{ id: 'plan', title: 'The plan', spec: { kind: 'gantt', units: ['May', 'Jun', 'Jul', 'Aug', 'Sep'], unitWidth: 170, lanes: [
				{ label: 'Build', color: 'blue', bars: [{ text: 'Design', start: 0, end: 1 }, { text: 'Build', start: 1, end: 3.5 }, { text: 'Test', start: 3.5, end: 4.5 }] },
				{ label: 'Launch', color: 'orange', bars: [{ text: 'Train support', start: 3, end: 4 }, { text: 'Go live', start: 4, end: 5 }] },
			] } },
			{ id: 'people', title: 'Who to keep close', spec: { kind: 'quadrant', yAxis: 'Influence (high at the top)', xAxis: 'Interest (low on the left, high on the right)', quadrants: [
				{ label: 'Keep satisfied', color: 'violet', items: ['Finance'] }, { label: 'Manage closely', color: 'red', items: ['Head of support'] },
				{ label: 'Monitor', color: 'grey', items: ['Facilities'] }, { label: 'Keep informed', color: 'blue', items: ['Sales'] },
			] } },
		],
	},
	{
		id: 'research-plan', title: 'Research plan', format: 'ideas', use: 'A question worth answering: what to ask, where to look, and what has turned up.',
		parts: [
			{ id: 'questions', title: 'What we want to know', spec: { kind: 'mindmap', root: { text: 'Why do trials stall?', children: [
				{ text: 'Setup', children: [{ text: 'Is import the blocker?' }, { text: 'Who does setup?' }] },
				{ text: 'Value', children: [{ text: 'When is the first win?' }] },
				{ text: 'Buying', children: [{ text: 'Who signs off?' }, { text: 'Is price the issue?' }] },
			] } } },
			{ id: 'sources', title: 'Where to look', spec: { kind: 'grid', cellWidth: 200, columns: ['Tells us', 'Cost', 'Confidence'], rows: [
				{ label: 'Product analytics', cells: ['Where people stop', 'Free', { text: 'High', color: 'green' }] },
				{ label: 'Interviews', cells: ['Why they stop', 'Two weeks', { text: 'Medium', color: 'orange' }] },
				{ label: 'Sales notes', cells: ['Who decides', 'A day', { text: 'Low', color: 'red' }] },
			] } },
			{ id: 'findings', title: 'What has turned up', spec: { kind: 'board', columns: [
				{ label: 'Found', color: 'green', cards: [{ text: 'Half stop at import', detail: 'From analytics: 52% of stalled trials never finished an import.' }] },
				{ label: 'Hunch', color: 'orange', cards: [{ text: 'Setup falls to one person' }] },
				{ label: 'Open', color: 'grey', cards: [{ text: 'Is price the issue?' }] },
			] } },
		],
	},
	{
		id: 'team-retro', title: 'Team retrospective', format: 'board', use: 'A retrospective that goes past the sticky notes: what happened, why the big one happened, and what to try.',
		parts: [
			{ id: 'board', title: 'How it went', spec: { kind: 'board', columns: [
				{ label: 'Went well', color: 'green', cards: [{ text: 'Shipped search on time' }, { text: 'Pairing on hard bugs' }] },
				{ label: 'To improve', color: 'orange', cards: [{ text: 'Flaky end-to-end tests' }, { text: 'Late design changes' }] },
			] } },
			{ id: 'why', title: 'Why the tests were flaky', spec: { kind: 'flow', direction: 'DOWN', gap: 40, layerGap: 50, boxWidth: 260, nodes: [
				{ id: 'p', text: 'Releases held up by flaky tests', color: 'red' }, { id: 'w1', text: 'Tests share one database' }, { id: 'w2', text: 'Runs overlap in CI' }, { id: 'c', text: 'Give each run its own database', color: 'green' },
			], edges: [{ from: 'p', to: 'w1', label: 'why?' }, { from: 'w1', to: 'w2', label: 'why?' }, { from: 'w2', to: 'c', label: 'so' }] } },
			{ id: 'try', title: 'What we will try', spec: { kind: 'board', columns: [{ label: 'Try next', color: 'blue', cards: [{ text: 'Database per CI run' }, { text: 'Design freeze a week out' }] }] } },
		],
	},
]

export const starterById = (id) => STARTERS.find((t) => t.id === id) ?? null
