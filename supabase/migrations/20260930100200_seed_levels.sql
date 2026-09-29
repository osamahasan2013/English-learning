-- The five learning levels the app needs to function (a parent cannot create a child
-- without choosing one). Seeded by migration so every environment has them, even before
-- any curriculum is imported. Values match content/reference.json; the content importer
-- keeps managing them afterwards (it matches on `code`, so this is idempotent), and new
-- levels are added through content, not migrations.
insert into public.levels (
  code, name, short_name, description, sort_order, min_age, max_age, difficulty,
  vocabulary_target, sight_word_target, max_sentence_words, phonics_scope,
  reading_complexity, writing_complexity, assessment_difficulty, theme_emoji, status
) values
  ('KG1', 'Kindergarten 1', 'KG1', 'Letters and their sounds, listening, and first words with pictures.', 1, 3, 4, 1, 100, 0, 3, 'Single letters: name, shape and main sound', 'Letters, simple picture words, very short phrases', 'Shapes and letter tracing', 1, '🌱', 'published'),
  ('KG2', 'Kindergarten 2', 'KG2', 'Blending sounds into CVC words, first sight words and short sentences.', 2, 4, 5, 2, 250, 20, 5, 'All single letters; short vowels in CVC words', 'CVC words, short sentences, basic sight words', 'Letter formation and simple words', 2, '🌿', 'published'),
  ('KG3', 'Kindergarten 3', 'KG3', 'Consonant digraphs, more sight words, simple paragraphs and short stories.', 3, 5, 6, 3, 450, 50, 7, 'Consonant digraphs (sh, ch, th, wh, ck, ng)', 'Simple paragraphs and short stories', 'CVC words and sight words', 3, '🌳', 'published'),
  ('GRADE1', 'Grade 1', 'G1', 'Vowel teams, longer stories, reading fluency and basic comprehension.', 4, 6, 7, 5, 800, 100, 10, 'Vowel teams (ee, ea, ai, ay, oa, ow, oo, ou, oi, oy)', 'Longer stories, fluency, basic comprehension', 'Simple sentences', 5, '📘', 'published'),
  ('GRADE2', 'Grade 2', 'G2', 'R-controlled vowels, word endings, multisyllabic words, comprehension and inference.', 5, 7, 8, 7, 1400, 200, 15, 'R-controlled vowels; endings -ing, -ed, -s, -es, -tion, -ment, -ness, -ful, -less', 'Longer paragraphs, multisyllabic words, age-appropriate inference', 'Short paragraphs', 7, '🚀', 'published')
on conflict (code) do nothing;
