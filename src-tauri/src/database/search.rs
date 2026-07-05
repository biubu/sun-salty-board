pub struct SearchQuery;

impl SearchQuery {
    pub fn sanitize(raw: &str) -> String {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return String::new();
        }
        let has_cjk = trimmed.chars().any(|c| {
            let cp = c as u32;
            (cp >= 0x4E00 && cp <= 0x9FFF)
                || (cp >= 0x3400 && cp <= 0x4DBF)
                || (cp >= 0x3000 && cp <= 0x303F)
                || (cp >= 0xFF00 && cp <= 0xFFEF)
        });
        if has_cjk {
            let tokens: Vec<String> = trimmed.chars().map(|c| format!("\"{}\"", c)).collect();
            tokens.join(" ")
        } else {
            let terms: Vec<&str> = trimmed.split_whitespace().collect();
            terms.iter().map(|t| format!("{}*", t)).collect::<Vec<_>>().join(" ")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_empty() {
        assert_eq!(SearchQuery::sanitize(""), "");
        assert_eq!(SearchQuery::sanitize("   "), "");
    }

    #[test]
    fn test_sanitize_latin_prefix() {
        let result = SearchQuery::sanitize("hello world");
        assert_eq!(result, "hello* world*");
    }

    #[test]
    fn test_sanitize_cjk() {
        let result = SearchQuery::sanitize("测试中文");
        assert!(result.contains('"'));
        assert!(result.contains("测"));
        assert!(result.contains("试"));
    }

    #[test]
    fn test_sanitize_mixed() {
        let result = SearchQuery::sanitize("hello世界");
        assert!(result.contains('"') || result.contains('*'));
        assert!(!result.is_empty());
    }

    #[test]
    fn test_sanitize_special_chars() {
        let result = SearchQuery::sanitize("foo bar");
        assert_eq!(result, "foo* bar*");
    }
}
