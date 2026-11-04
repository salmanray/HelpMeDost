INSERT INTO service_categories (slug, name, description, is_active, display_order)
SELECT v.slug, v.name, v.description, true, v.display_order
FROM (VALUES
 ('student-help','Student Help','School and student-related questions',1),
 ('admissions','Admissions','Admission and application guidance',2),
 ('documents','Forms and Documents','Forms and document assistance',3),
 ('digital-support','Digital Support','Online and digital service guidance',4),
 ('parent-guidance','Parent Guidance','Guidance for parents and families',5),
 ('other','Other Assistance','Other helpdesk requests',6)
) AS v(slug,name,description,display_order)
WHERE NOT EXISTS (SELECT 1 FROM service_categories c WHERE c.slug=v.slug);