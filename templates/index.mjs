// The template roster. Each is data for a layout in lib/layouts.mjs: the content is a realistic example of its use, so a
// template is also a sample diagram and a test case. `format` says how the canvas behaves once it's made.
export const TEMPLATES = [
	{
		id: 'flowchart', title: 'Flowchart', format: 'process', kind: 'flow', use: 'A process with decisions: how something gets done, and what happens when it goes wrong.', direction: 'DOWN', route: 'elbow', gap: 70, layerGap: 60, boxWidth: 190,
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
		id: 'swimlane', title: 'Swimlane process', format: 'process', kind: 'lanes', use: 'A process across several people or teams, so handoffs show.',
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
		id: 'org-chart', title: 'Org chart', format: 'hierarchy', kind: 'tree', use: 'Who reports to whom.', route: 'elbow', head: 'none', levelColors: ['black', 'blue', 'light-blue'], boxWidth: 170,
		root: { text: 'Chief Executive', children: [
			{ text: 'Product', children: [{ text: 'Design' }, { text: 'Research' }] },
			{ text: 'Engineering', detail: 'Platform and application teams, about 40 people.', children: [{ text: 'Platform' }, { text: 'Applications' }, { text: 'Data' }] },
			{ text: 'Operations', children: [{ text: 'Finance' }, { text: 'People' }] },
		] },
	},
	{
		id: 'decision-tree', title: 'Decision tree', format: 'hierarchy', kind: 'tree', use: 'Choosing between outcomes, one question at a time.', boxWidth: 190, levelColors: ['black', 'orange', 'green'], layerGap: 110,
		root: { text: 'Is the data relational?', children: [
			{ text: 'Over 1 TB?', edge: 'yes', children: [{ text: 'Partitioned Postgres', edge: 'yes' }, { text: 'Plain Postgres', edge: 'no' }] },
			{ text: 'Mostly key lookups?', edge: 'no', children: [{ text: 'Key-value store', edge: 'yes' }, { text: 'Document store', edge: 'no' }] },
		] },
	},
	{
		id: 'mind-map', title: 'Mind map', format: 'hierarchy', kind: 'mindmap', use: 'Getting ideas out and grouping them, around one central topic.',
		root: { text: 'Launch plan', children: [
			{ text: 'Audience', children: [{ text: 'Existing customers' }, { text: 'Trade press' }, { text: 'New segments' }] },
			{ text: 'Message', children: [{ text: 'Core promise' }, { text: 'Proof points' }] },
			{ text: 'Channels', children: [{ text: 'Email' }, { text: 'Web' }, { text: 'Events' }, { text: 'Partners' }] },
			{ text: 'Risks', children: [{ text: 'Timing' }, { text: 'Support load' }] },
			{ text: 'Measures', children: [{ text: 'Sign-ups' }, { text: 'Activation' }, { text: 'Retention' }] },
		] },
	},
	{
		id: 'sequence', title: 'Sequence diagram', format: 'process', kind: 'sequence', use: 'Who says what to whom, in order: protocols and integrations.',
		participants: [{ id: 'browser', text: 'Browser' }, { id: 'app', text: 'App server' }, { id: 'idp', text: 'Identity provider' }, { id: 'api', text: 'Resource API' }],
		messages: [
			{ from: 'browser', to: 'app', text: 'Open /account' }, { from: 'app', to: 'browser', text: 'Redirect to sign-in', reply: true }, { from: 'browser', to: 'idp', text: 'Sign in' },
			{ from: 'idp', to: 'browser', text: 'Authorization code', reply: true }, { from: 'browser', to: 'app', text: 'Code' }, { from: 'app', to: 'idp', text: 'Exchange code' }, { from: 'idp', to: 'app', text: 'Tokens', reply: true },
			{ from: 'app', to: 'api', text: 'Fetch profile' }, { from: 'api', to: 'app', text: 'Profile', reply: true }, { from: 'app', to: 'browser', text: 'Render page', reply: true },
		],
	},
	{
		id: 'architecture', title: 'Layered architecture', format: 'system', kind: 'stack', use: 'How a system is layered, and what talks to what.',
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
		id: 'services', title: 'Service map', format: 'system', kind: 'flow', use: 'Services and their dependencies, grouped by boundary.', direction: 'RIGHT', gap: 50, layerGap: 100, boxWidth: 150, route: 'elbow',
		groups: [{ id: 'public', label: 'Public' }, { id: 'core', label: 'Core' }, { id: 'stores', label: 'Stores' }],
		nodes: [
			{ id: 'site', text: 'Web shop', group: 'public', color: 'blue' }, { id: 'cart', text: 'Cart', group: 'public', color: 'blue' },
			{ id: 'ord', text: 'Orders', group: 'core', color: 'green' }, { id: 'pay', text: 'Payments', group: 'core', color: 'green' }, { id: 'stock', text: 'Inventory', group: 'core', color: 'green' },
			{ id: 'pg', text: 'Postgres', group: 'stores', color: 'orange' }, { id: 'mail', text: 'Email', group: 'stores', color: 'orange' },
		],
		edges: [{ from: 'site', to: 'cart' }, { from: 'cart', to: 'ord' }, { from: 'ord', to: 'pay' }, { from: 'ord', to: 'stock' }, { from: 'stock', to: 'pg' }, { from: 'pay', to: 'pg' }, { from: 'pay', to: 'mail' }],
	},
	{
		id: 'network', title: 'Network topology', format: 'system', kind: 'tree', use: 'How machines and networks connect.', boxWidth: 170, head: 'none', levelColors: ['violet', 'blue', 'green', 'grey'],
		root: { text: 'Internet', shape: 'cloud', children: [
			{ text: 'Firewall', children: [
				{ text: 'Public subnet', children: [{ text: 'Load balancer' }, { text: 'Bastion host' }] },
				{ text: 'Private subnet', children: [{ text: 'App servers' }, { text: 'Workers' }, { text: 'Database' }] },
			] },
		] },
	},
	{
		id: 'er-diagram', title: 'Entity relationships', format: 'system', kind: 'flow', use: 'A data model: what is stored, and how it relates.', direction: 'RIGHT', boxWidth: 190, gap: 70, layerGap: 140,
		nodes: [
			{ id: 'user', text: 'User\nid, email, name', color: 'blue' }, { id: 'post', text: 'Post\nid, title, body', color: 'blue' }, { id: 'comment', text: 'Comment\nid, body', color: 'blue' }, { id: 'tag', text: 'Tag\nid, name', color: 'blue' }, { id: 'posttag', text: 'PostTag\npost_id, tag_id', color: 'grey' },
		],
		edges: [{ from: 'user', to: 'post', label: '1 to many' }, { from: 'post', to: 'comment', label: '1 to many' }, { from: 'user', to: 'comment', label: '1 to many' }, { from: 'post', to: 'posttag', label: '1 to many' }, { from: 'posttag', to: 'tag', label: 'many to 1' }],
	},
	{
		id: 'state-machine', title: 'State machine', format: 'process', kind: 'flow', use: 'The states something moves through, and what moves it.', direction: 'RIGHT', gap: 90, layerGap: 110, boxWidth: 130,
		nodes: [
			{ id: 'draft', text: 'Draft', shape: 'oval', color: 'grey' }, { id: 'placed', text: 'Placed', shape: 'oval', color: 'blue' }, { id: 'paid', text: 'Paid', shape: 'oval', color: 'blue' }, { id: 'shipped', text: 'Shipped', shape: 'oval', color: 'blue' }, { id: 'delivered', text: 'Delivered', shape: 'oval', color: 'green' }, { id: 'cancelled', text: 'Cancelled', shape: 'oval', color: 'red' },
		],
		edges: [{ from: 'draft', to: 'placed', label: 'checkout' }, { from: 'placed', to: 'paid', label: 'payment' }, { from: 'paid', to: 'shipped', label: 'dispatch' }, { from: 'shipped', to: 'delivered', label: 'receipt' }, { from: 'placed', to: 'cancelled', label: 'cancel' }, { from: 'paid', to: 'cancelled', label: 'refund' }],
	},
	{
		id: 'pipeline', title: 'Build pipeline', format: 'process', kind: 'flow', use: 'Stages with dependencies: builds, data pipelines, project plans.', direction: 'RIGHT', gap: 50, layerGap: 70, boxWidth: 130, route: 'elbow',
		nodes: [
			{ id: 'checkout', text: 'Checkout', color: 'grey' }, { id: 'lint', text: 'Lint', color: 'blue' }, { id: 'unit', text: 'Unit tests', color: 'blue' }, { id: 'build', text: 'Build image', color: 'blue' }, { id: 'e2e', text: 'End-to-end tests', color: 'violet' }, { id: 'scan', text: 'Security scan', color: 'violet' }, { id: 'staging', text: 'Deploy to staging', color: 'orange' }, { id: 'approve', text: 'Approve', shape: 'diamond', color: 'orange' }, { id: 'prod', text: 'Deploy to production', color: 'green' },
		],
		edges: [{ from: 'checkout', to: 'lint' }, { from: 'checkout', to: 'unit' }, { from: 'lint', to: 'build' }, { from: 'unit', to: 'build' }, { from: 'build', to: 'e2e' }, { from: 'build', to: 'scan' }, { from: 'e2e', to: 'staging' }, { from: 'scan', to: 'staging' }, { from: 'staging', to: 'approve' }, { from: 'approve', to: 'prod' }],
	},
	{
		id: 'roadmap', title: 'Roadmap', format: 'timeline', kind: 'gantt', use: 'What happens when, by team or workstream.', units: ['Q1', 'Q2', 'Q3', 'Q4'], unitWidth: 240,
		lanes: [
			{ label: 'Product', color: 'blue', bars: [{ text: 'Research', start: 0, end: 1 }, { text: 'Beta', start: 1, end: 2.5 }, { text: 'General release', start: 2.5, end: 4 }] },
			{ label: 'Platform', color: 'green', bars: [{ text: 'Migration', start: 0, end: 2 }, { text: 'Scale work', start: 1.5, end: 3.5 }] },
			{ label: 'Go to market', color: 'orange', bars: [{ text: 'Positioning', start: 1, end: 2 }, { text: 'Launch campaign', start: 2.5, end: 3.5 }] },
		],
	},
	{
		id: 'timeline', title: 'Timeline', format: 'timeline', kind: 'timeline', use: 'Events in order: a history, an incident, a project.',
		items: [
			{ when: '09:02', text: 'Alert fires' }, { when: '09:06', text: 'On-call acknowledges' }, { when: '09:15', text: 'Bad deploy suspected', color: 'orange' }, { when: '09:21', text: 'Rollback starts', color: 'orange' }, { when: '09:34', text: 'Error rate recovers', color: 'green' }, { when: '10:30', text: 'All clear', color: 'green', detail: 'Followed by a review two days later.' },
		],
	},
	{
		id: 'kanban', title: 'Kanban board', format: 'board', kind: 'board', use: 'Work by status.',
		columns: [
			{ label: 'To do', color: 'grey', cards: [{ text: 'Write onboarding guide' }, { text: 'Audit permissions' }, { text: 'Update pricing page' }] },
			{ label: 'In progress', color: 'blue', cards: [{ text: 'Billing migration' }, { text: 'Search relevance' }] },
			{ label: 'In review', color: 'violet', cards: [{ text: 'Mobile sign-in' }] },
			{ label: 'Done', color: 'green', cards: [{ text: 'New dashboard' }, { text: 'Export to CSV' }, { text: 'Fix date filters' }, { text: 'Upgrade database' }] },
		],
	},
	{
		id: 'quadrant', title: '2x2 matrix', format: 'board', kind: 'quadrant', use: 'Sorting options along two dimensions.', yAxis: 'Impact (low at the bottom, high at the top)', xAxis: 'Effort (low on the left, high on the right)',
		quadrants: [
			{ label: 'Quick wins', color: 'green', items: ['Better empty states', 'Faster search', 'Saved filters'] },
			{ label: 'Big bets', color: 'blue', items: ['Offline mode', 'Public API'] },
			{ label: 'Fill-ins', color: 'grey', items: ['New icons', 'Dark-mode polish'] },
			{ label: 'Avoid', color: 'red', items: ['Custom themes', 'Legacy importer', 'Desktop app'] },
		],
	},
	{
		id: 'journey-map', title: 'Customer journey', format: 'board', kind: 'grid', use: 'A person’s experience across stages, and where it hurts.',
		columns: ['Discover', 'Compare', 'Sign up', 'First use', 'Renew'],
		rows: [
			{ label: 'Doing', color: 'blue', cells: ['Reads a review', 'Checks pricing', 'Creates an account', 'Imports data', 'Gets a reminder'] },
			{ label: 'Feeling', color: 'orange', cells: ['Curious', 'Unsure', 'Impatient', 'Relieved', 'Indifferent'] },
			{ label: 'Pain', color: 'red', cells: ['', 'Plans are hard to compare', 'Too many fields', 'Import errors are vague', 'Renewal is a surprise'] },
			{ label: 'Idea', color: 'green', cells: ['', 'Plan chooser', 'Sign up with a link', 'Show what to fix', 'Warn a month ahead'] },
		],
	},
	{
		id: 'responsibility', title: 'Responsibility chart', format: 'board', kind: 'grid', use: 'Who is responsible, accountable, consulted and informed.', cellWidth: 150, labelWidth: 210,
		columns: ['Product', 'Engineering', 'Design', 'Legal'],
		rows: [
			{ label: 'Set requirements', cells: [{ text: 'Accountable', color: 'blue' }, { text: 'Consulted' }, { text: 'Consulted' }, { text: 'Informed' }] },
			{ label: 'Design the flow', cells: [{ text: 'Consulted' }, { text: 'Consulted' }, { text: 'Accountable', color: 'blue' }, { text: 'Informed' }] },
			{ label: 'Build it', cells: [{ text: 'Informed' }, { text: 'Accountable', color: 'blue' }, { text: 'Consulted' }, { text: '' }] },
			{ label: 'Review terms', cells: [{ text: 'Consulted' }, { text: 'Informed' }, { text: '' }, { text: 'Accountable', color: 'blue' }] },
		],
	},
	{
		id: 'comparison', title: 'Comparison table', format: 'board', kind: 'grid', use: 'Weighing options against criteria.', cellWidth: 230,
		columns: ['Build it', 'Buy it', 'Partner'],
		rows: [
			{ label: 'Cost', cells: ['High up front', 'Yearly licence', 'Revenue share'] },
			{ label: 'Time to ship', cells: ['Six months', 'Six weeks', 'Three months'] },
			{ label: 'Control', cells: [{ text: 'Full', color: 'green' }, { text: 'Limited', color: 'orange' }, { text: 'Shared', color: 'orange' }] },
			{ label: 'Risk', cells: ['Delivery', { text: 'Vendor lock-in', color: 'red' }, 'Partner priorities'] },
		],
	},
	{
		id: 'fishbone', title: 'Fishbone diagram', format: 'hierarchy', kind: 'fishbone', use: 'Finding the causes behind a problem.', effect: 'Checkout failures up 40%',
		causes: [
			{ label: 'People', color: 'blue', items: ['New on-call rota', 'Handover gaps'] }, { label: 'Process', color: 'orange', items: ['No staged rollout', 'Manual config'] },
			{ label: 'Technology', color: 'green', items: ['Payment timeouts', 'Retry storms'] }, { label: 'Vendors', color: 'violet', items: ['Provider outage', 'API version change'] },
		],
	},
	{
		id: 'funnel', title: 'Funnel', format: 'process', kind: 'funnel', use: 'Stages that narrow, and where people drop out.',
		stages: [{ text: 'Visit the site: 40,000' }, { text: 'Start sign-up: 6,000', drop: '85% leave' }, { text: 'Finish sign-up: 3,600', drop: '40% leave' }, { text: 'Activate: 1,500', drop: '58% leave' }, { text: 'Pay: 450', drop: '70% leave' }],
	},
	{
		id: 'cycle', title: 'Cycle', format: 'process', kind: 'cycle', use: 'A loop that repeats: plan, do, check, act.', centre: 'Continuous improvement',
		colors: ['blue', 'green', 'orange', 'violet'], stages: [{ text: 'Plan', detail: 'Decide what to change and how to measure it.' }, { text: 'Do' }, { text: 'Check' }, { text: 'Act' }],
	},
]

export const templateList = () => TEMPLATES.map(({ id, title, use, format, kind }) => ({ id, title, use, format, kind }))
export const templateById = (id) => TEMPLATES.find((t) => t.id === id) ?? null
